"""Real pinned Hermes HTTP/WS auth with local signed tokens, no Portal traffic."""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import time
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import pytest

pytestmark = pytest.mark.integration
ROOT = Path(__file__).resolve().parents[1]
ORIGIN = "https://sparkie.test"
PORTAL = "https://portal.fixture.test"
CLIENT = "agent:fixture-dashboard"
OWNER = "fixture-owner-subject"


@pytest.fixture(scope="module")
def native_bundle(tmp_path_factory):
    from plugins.dashboard_auth import nous
    spec = importlib.util.spec_from_file_location("sparkie_package_plugins", ROOT / "tools/package_plugins.py")
    packaging = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(packaging)
    upstream = Path(nous.__file__).resolve().parents[2]
    bundle = tmp_path_factory.mktemp("sealed-plugins") / "plugins"
    packaging.prepare_bundle(upstream, bundle, ROOT / "plugin")
    native_manifests = {p.relative_to(upstream) for p in upstream.rglob("plugin.*")
                        if p.name in {"plugin.yaml", "plugin.yml", "plugin.json"}
                        and p.relative_to(upstream).parts[0] != "dashboard_auth"}
    assert native_manifests <= {p.relative_to(bundle) for p in bundle.rglob("plugin.*")}
    assert (bundle / "dashboard_auth/nous/__init__.py").read_bytes() == Path(nous.__file__).read_bytes()
    assert not list((bundle / "dashboard_auth").rglob("plugin.yaml"))
    return bundle


@pytest.fixture(params=["dashboard", "webapp"])
def app(tmp_path, monkeypatch, request, native_bundle):
    import httpx
    import jwt
    from cryptography.hazmat.primitives.asymmetric import rsa
    from fastapi.testclient import TestClient
    from hermes_cli.dashboard_auth import clear_providers, listener_client
    from hermes_cli.dashboard_auth.registry import get_provider, list_providers
    from hermes_cli.dashboard_auth import ws_tickets, native_flow
    from hermes_cli.plugins import PluginManager
    from plugins.dashboard_auth import _shared
    from sparkie_sparks.owner_login import OWNER_SETTING

    home = tmp_path / "hermes"
    shutil.copytree(ROOT / "plugin", home / "plugins/sparkie-sparks")
    shutil.copyfile(ROOT / "config/hermes.example.yaml", home / "config.yaml")
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setenv("HERMES_BUNDLED_PLUGINS", str(native_bundle))
    monkeypatch.setenv(OWNER_SETTING, OWNER)
    monkeypatch.setenv("HERMES_DASHBOARD_OAUTH_CLIENT_ID", CLIENT)
    monkeypatch.setenv("HERMES_DASHBOARD_PORTAL_URL", PORTAL)
    # Ambient stock credentials must not create another native provider.
    monkeypatch.setenv("HERMES_DASHBOARD_BASIC_AUTH_USERNAME", "fixture")
    monkeypatch.setenv("HERMES_DASHBOARD_BASIC_AUTH_PASSWORD", "fixture-unused-password")
    monkeypatch.setenv("HERMES_DASHBOARD_SESSION_TOKEN", "fixture-unused-session-token-" * 3)
    monkeypatch.setenv("HERMES_DASHBOARD_DRAIN_SECRET", "fixture-unused-maintenance-" * 3)
    for attr in ("_swap", "_current"):
        monkeypatch.setattr(listener_client, attr, None)
    clear_providers()
    ws_tickets._reset_for_tests()
    native_flow._reset_for_tests()

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key()))
    public_jwk.update(kid="fixture-key", use="sig", alg="RS256")
    def jwks(url):
        client = jwt.PyJWKClient(url)
        monkeypatch.setattr(client, "fetch_data", lambda: {"keys": [public_jwk]})
        return client
    monkeypatch.setattr(_shared, "make_jwks_client", jwks)
    def token(subject=OWNER, *, audience=CLIENT, issuer=PORTAL, expiry=3600, scope="agent_dashboard:access"):
        return jwt.encode({"sub": subject, "aud": audience, "iss": issuer,
                           "exp": int(time.time()) + expiry, "iat": int(time.time()) - 1,
                           "scope": scope, "oauth_contract_version": 1}, key,
                          algorithm="RS256", headers={"kid": "fixture-key"})
    calls = []
    def portal_post(url, *, data, headers, timeout):
        assert url == PORTAL + "/api/oauth/token"
        calls.append(dict(data))
        credential = data.get("code", data.get("refresh_token"))
        subject = OWNER if credential in {"owner", "owner-refresh", "owner-rotated"} else "other-owner"
        return httpx.Response(200, json={"access_token": token(subject, audience=data["client_id"]),
                                        "refresh_token": "owner-rotated" if subject == OWNER else "other-rotated",
                                        "token_type": "bearer"})
    monkeypatch.setattr(_shared.httpx, "post", portal_post)

    manager = PluginManager(scope_key=str(home))
    manager.discover_and_load()
    assert [p.name for p in list_providers()] == ["sparkie-owner"]
    provider = get_provider("sparkie-owner")
    assert provider is not None
    from hermes_cli import web_server
    for name, value in {"bound_host": "sparkie.test", "bound_port": 443,
                        "auth_required": True, "ui_surface": request.param,
                        "webapp_home": home}.items():
        monkeypatch.setattr(web_server.app.state, name, value, raising=False)
    client = TestClient(web_server.app, base_url=ORIGIN, follow_redirects=False)
    yield SimpleNamespace(client=client, provider=provider, token=token, home=home,
                          manager=manager, calls=calls, portal_post=portal_post)
    client.close()
    clear_providers()
    ws_tickets._reset_for_tests()
    native_flow._reset_for_tests()


def login(client, code="owner"):
    start = client.get("/auth/login", params={"provider": "sparkie-owner"})
    assert start.status_code == 302, start.text
    query = parse_qs(urlparse(start.headers["location"]).query)
    assert query["code_challenge_method"] == ["S256"]
    assert query["scope"] == ["agent_dashboard:access"]
    return client.get("/auth/callback", params={"code": code, "state": query["state"][0]})


def native_login(client):
    verifier = "fixture-native-verifier-" * 3
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    start = client.get("/auth/native/authorize", params={"provider": "sparkie-owner",
        "code_challenge": challenge, "code_challenge_method": "S256",
        "redirect_uri": "http://127.0.0.1:53999/cb", "state": "fixture-native-state"})
    assert start.status_code == 302, start.text
    state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
    callback = client.get("/auth/callback", params={"code": "owner", "state": state})
    assert callback.status_code == 302, callback.text
    code = parse_qs(urlparse(callback.headers["location"]).query)["code"][0]
    tokens = client.post("/auth/native/token", json={"code": code, "code_verifier": verifier})
    assert tokens.status_code == 200, tokens.text
    client.cookies.clear()
    return tokens.json()


def replace_cookie(client, prefix, value):
    cookie = next(c for c in client.cookies.jar if prefix in c.name)
    client.cookies.set(cookie.name, value, domain=cookie.domain, path=cookie.path)


def test_native_login_authorizes_owner_and_keeps_native_provider_identity(app):
    assert login(app.client).status_code == 302
    me = app.client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["user_id"] == OWNER
    assert me.json()["provider"] == "sparkie-owner"
    assert app.client.get("/api/config").status_code == 200
    assert app.calls[0]["grant_type"] == "authorization_code"
    assert app.calls[0]["client_id"] == CLIENT
    assert app.calls[0]["code_verifier"]


def test_signed_other_account_cannot_log_in_or_receive_cookies(app):
    assert login(app.client, "other").status_code == 400
    assert not any("hermes_session_at" in c.name for c in app.client.cookies.jar)
    assert app.client.get("/api/config").status_code == 401


@pytest.mark.parametrize("kind", ["bearer", "cookie"])
@pytest.mark.parametrize("subject,expected", [(OWNER, 200), ("other-owner", 401)])
def test_native_general_api_checks_subject_for_every_credential(app, kind, subject, expected):
    headers = {}
    if kind == "bearer":
        token = native_login(app.client)["access_token"] if subject == OWNER else app.token(subject)
        headers["Authorization"] = "Bearer " + token
    else:
        assert login(app.client).status_code == 302
        replace_cookie(app.client, "hermes_session_at", app.token(subject))
        # Reject this request instead of using the owner's still-valid refresh
        # cookie to establish a separate owner session.
        replace_cookie(app.client, "hermes_session_rt", "other-refresh" if subject != OWNER else "owner-refresh")
    assert app.client.get("/api/config", headers=headers).status_code == expected
    assert app.client.get("/api/auth/me", headers=headers).status_code == expected


@pytest.mark.parametrize("refresh,expected", [("owner-refresh", 200), ("other-refresh", 401)])
def test_native_refresh_rotates_only_owner_and_never_adopts_other_identity(app, refresh, expected):
    assert login(app.client).status_code == 302
    replace_cookie(app.client, "hermes_session_at", app.token(expiry=-3600))
    replace_cookie(app.client, "hermes_session_rt", refresh)
    response = app.client.get("/api/auth/me")
    assert response.status_code == expected
    if expected == 200:
        assert response.json()["user_id"] == OWNER
        assert "owner-rotated" in response.headers.get("set-cookie", "")
    assert app.calls[-1]["grant_type"] == "refresh_token"


@pytest.mark.parametrize("subject", [OWNER, "other-owner"])
def test_actual_native_websocket_handshake_filters_signed_identity(app, subject):
    from starlette.websockets import WebSocketDisconnect
    token = native_login(app.client)["access_token"] if subject == OWNER else app.token(subject)
    url = "wss://sparkie.test/api/events?channel=fixture-channel&token=" + token
    if subject == OWNER:
        with app.client.websocket_connect(url, headers={"Origin": ORIGIN}):
            pass
    else:
        with pytest.raises(WebSocketDisconnect) as denied:
            with app.client.websocket_connect(url, headers={"Origin": ORIGIN}):
                pytest.fail("Other account opened a native event socket")
        assert denied.value.code == 4401


def test_native_ticket_needs_owner_and_is_single_use_on_actual_socket(app):
    from starlette.websockets import WebSocketDisconnect
    assert app.client.post("/api/auth/ws-ticket", headers={"Origin": ORIGIN}).status_code == 401
    assert app.client.post("/api/auth/ws-ticket", headers={"Origin": ORIGIN,
        "Authorization": "Bearer " + app.token("other-owner")}).status_code == 401
    assert login(app.client).status_code == 302
    response = app.client.post("/api/auth/ws-ticket", headers={"Origin": ORIGIN})
    assert response.status_code == 200
    socket = "wss://sparkie.test/api/events?channel=fixture-channel&ticket=" + response.json()["ticket"]
    with app.client.websocket_connect(socket, headers={"Origin": ORIGIN}):
        pass
    with pytest.raises(WebSocketDisconnect):
        with app.client.websocket_connect(socket, headers={"Origin": ORIGIN}):
            pytest.fail("Used ticket opened another socket")


@pytest.mark.parametrize("claims", [{"audience": "agent:other"}, {"issuer": "https://other.test"},
                                    {"expiry": -3600}, {"scope": "agent:peer"}])
def test_native_jwt_validation_remains_in_force(app, claims):
    assert app.provider.verify_session(access_token=app.token(**claims)) is None


def test_peer_pass_cannot_bypass_subject_filter(app):
    assert app.provider.verify_peer_pass(token=app.token()).principal == OWNER
    assert app.provider.verify_peer_pass(token=app.token("other-owner")) is None


def test_portal_outage_stays_unavailable_without_clearing_owner_cookies(app, monkeypatch):
    import httpx
    from plugins.dashboard_auth import _shared
    def unavailable(*args, **kwargs):
        raise httpx.ConnectError("fixture issuer offline")
    assert login(app.client).status_code == 302
    monkeypatch.setattr(_shared.httpx, "post", unavailable)
    replace_cookie(app.client, "hermes_session_at", app.token(expiry=-3600))
    replace_cookie(app.client, "hermes_session_rt", "owner-refresh")
    assert app.client.get("/api/config").status_code == 503
    assert next(c.value for c in app.client.cookies.jar if "hermes_session_rt" in c.name) == "owner-refresh"


def test_native_listener_swap_and_forced_plugin_reload_keep_owner_check(app):
    from hermes_cli.dashboard_auth import listener_client
    from hermes_cli.dashboard_auth.registry import get_provider, list_providers
    own_client = "agent:fixture-webapp"
    undo = listener_client.use(own_client, PORTAL)
    assert undo is not None
    try:
        for reload in (False, True):
            if reload:
                app.manager.discover_and_load(force=True)
            assert [p.name for p in list_providers()] == ["sparkie-owner"]
            provider = get_provider("sparkie-owner")
            assert provider.verify_session(access_token=app.token(audience=own_client)).user_id == OWNER
            assert provider.verify_session(access_token=app.token("other-owner", audience=own_client)) is None
            assert provider.verify_session(access_token=app.token()) is None
            start = app.client.get("/auth/login", params={"provider": "sparkie-owner"})
            assert parse_qs(urlparse(start.headers["location"]).query)["client_id"] == [own_client]
            assert app.client.get("/auth/login", params={"provider": "nous"}).status_code == 404
    finally:
        undo()
    restored = get_provider("sparkie-owner")
    assert restored.verify_session(access_token=app.token()).user_id == OWNER
    assert restored.verify_session(access_token=app.token(audience=own_client)) is None


@pytest.mark.parametrize("missing", ["SPARKIE_WEB_OWNER_SUBJECT", "HERMES_DASHBOARD_OAUTH_CLIENT_ID"])
def test_missing_protected_setup_on_reload_removes_previous_sign_in(app, monkeypatch, missing):
    from hermes_cli.dashboard_auth.registry import list_providers
    monkeypatch.delenv(missing)
    app.manager.discover_and_load(force=True)
    assert list_providers() == []
    assert app.client.get("/api/config", headers={"Authorization": "Bearer " + app.token()}).status_code == 401
    assert "Sign-in unavailable" in app.client.get("/login").text


def test_no_first_visitor_enrollment_even_with_native_listener_client(app, monkeypatch):
    from hermes_cli.dashboard_auth import listener_client
    from hermes_cli.dashboard_auth.registry import list_providers
    monkeypatch.delenv("SPARKIE_WEB_OWNER_SUBJECT")
    app.manager.discover_and_load(force=True)
    with pytest.raises(ValueError, match="exact web owner"):
        listener_client.use("agent:fixture-webapp", PORTAL)
    assert list_providers() == []


@pytest.mark.parametrize("profile_config", ["{}\n", "plugins:\n  enabled: [dashboard_auth/nous, dashboard_auth/basic, dashboard_auth/self_hosted, dashboard_auth/session_token]\n"])
def test_packaged_native_collection_prevents_other_profile_stock_listener_offer(app, profile_config):
    from hermes_cli.plugins import PluginManager
    from hermes_cli.dashboard_auth import listener_client
    from hermes_cli.dashboard_auth.registry import list_providers
    other = app.home / "profiles/other"
    other.mkdir(parents=True)
    (other / "config.yaml").write_text(profile_config)
    PluginManager(scope_key=str(other)).discover_and_load()
    assert [p.name for p in list_providers()] == ["sparkie-owner"]
    undo = listener_client.use("agent:other-listener", PORTAL)
    assert undo is not None
    try:
        providers = list_providers()
        assert [p.name for p in providers] == ["sparkie-owner"]
        assert all(p.verify_session(access_token=app.token("other-owner", audience="agent:other-listener")) is None for p in providers)
    finally:
        undo()


def test_incomplete_nonlaunch_profile_cannot_revoke_or_swap_config_only_launch_auth(app, monkeypatch):
    from hermes_cli.plugins import PluginManager
    from hermes_cli.dashboard_auth import listener_client
    from hermes_cli.dashboard_auth.registry import get_provider
    monkeypatch.delenv("HERMES_DASHBOARD_OAUTH_CLIENT_ID")
    with (app.home / "config.yaml").open("a") as stream:
        stream.write("\ndashboard:\n  oauth:\n    client_id: " + CLIENT + "\n")
    app.manager.discover_and_load(force=True)
    provider = get_provider("sparkie-owner")
    offered = listener_client._swap
    other = app.home / "profiles/incomplete"
    other.mkdir(parents=True)
    (other / "config.yaml").write_text("plugins:\n  enabled: [sparkie-sparks]\n")
    PluginManager(scope_key=str(other)).discover_and_load()
    assert get_provider("sparkie-owner") is provider
    assert listener_client._swap is offered
    assert provider.verify_session(access_token=app.token()).user_id == OWNER


def test_listener_restore_cannot_resurrect_revoked_owner(app, monkeypatch):
    from hermes_cli.dashboard_auth import listener_client
    from hermes_cli.dashboard_auth.registry import list_providers
    undo = listener_client.use("agent:temporary-listener", PORTAL)
    monkeypatch.delenv("SPARKIE_WEB_OWNER_SUBJECT")
    app.manager.discover_and_load(force=True)
    assert list_providers() == []
    undo()
    assert list_providers() == []


def test_old_listener_restore_does_not_replace_unrelated_provider(app):
    from hermes_cli.dashboard_auth import listener_client
    from hermes_cli.dashboard_auth.registry import get_provider, register_global_provider
    from sparkie_sparks.owner_login import OwnerNousProvider
    undo = listener_client.use("agent:temporary-listener", PORTAL)
    replacement = OwnerNousProvider(owner_subject=OWNER, client_id="agent:unrelated", portal_url=PORTAL)
    register_global_provider(replacement)
    undo()
    assert get_provider("sparkie-owner") is replacement
