"""One-owner authorization over Hermes's native Nous sign-in.

OAuth, PKCE, JWT verification, cookies and refresh stay upstream. The exact
owner subject is supplied by protected launch configuration, never model text
or the first visitor. A missing setting leaves public sign-in unavailable.
"""
from __future__ import annotations

import logging
import os

from hermes_cli.dashboard_auth import InvalidCodeError, RefreshExpiredError, listener_client
from hermes_cli.dashboard_auth.registry import (
    get_provider, register_global_provider, unregister_global_provider,
)
from plugins.dashboard_auth import nous
from plugins.dashboard_auth._shared import SkipRegistration

log = logging.getLogger(__name__)
OWNER_SETTING = "SPARKIE_WEB_OWNER_SUBJECT"


class OwnerNousProvider(nous.NousDashboardAuthProvider):
    """Use the native provider unchanged, then authorize its verified identity."""

    name = "sparkie-owner"
    display_name = "Nous Research"

    def __init__(self, *, owner_subject: str, **kwargs):
        if not isinstance(owner_subject, str) or not owner_subject or owner_subject.strip() != owner_subject:
            raise ValueError("The exact web owner subject must be configured before sign-in")
        super().__init__(**kwargs)
        self._owner_subject = owner_subject

    def complete_login(self, **kwargs):
        session = super().complete_login(**kwargs)
        if session.user_id != self._owner_subject:
            raise InvalidCodeError("This sign-in is not the configured owner")
        return session

    def verify_session(self, *, access_token):
        session = super().verify_session(access_token=access_token)
        return session if session is not None and session.user_id == self._owner_subject else None

    def refresh_session(self, *, refresh_token):
        session = super().refresh_session(refresh_token=refresh_token)
        if session.user_id != self._owner_subject:
            raise RefreshExpiredError("This sign-in is not the configured owner")
        return session

    def verify_peer_pass(self, *, token):
        principal = super().verify_peer_pass(token=token)
        return principal if principal is not None and principal.principal == self._owner_subject else None


def _build_provider():
    # Use the same native client resolver as Nous, including a Web Access
    # listener's own client. The distinct name keeps Session.provider exact.
    return OwnerNousProvider(owner_subject=os.environ.get(OWNER_SETTING, ""), **nous._settings())


def _swap_provider():
    """Native Web Access client swaps retain owner authorization, including reload."""
    provider = _build_provider()
    register_global_provider(provider)

    def restore():
        # Native use() clears its listener client before calling this. A forced
        # reload may have replaced our object, so identity-only restoration
        # would leave the listener's client active. Restore this same listener
        # lineage from current protected settings, never a stale owner snapshot.
        current = get_provider(OwnerNousProvider.name)
        if not isinstance(current, OwnerNousProvider) or (
            current._client_id, current._portal_url
        ) != (provider._client_id, provider._portal_url):
            return
        try:
            restored = _build_provider()
        except (ValueError, SkipRegistration):
            unregister_global_provider(OwnerNousProvider.name, current)
            return
        register_global_provider(restored)

    return restore


def register(ctx):
    from hermes_constants import get_hermes_home, get_process_hermes_home, hermes_home_key
    # Auth is process-owned in native Hermes. Profile loading must not replace
    # its listener callback or revoke the launch profile's provider on a missing
    # setting, even before the native registrar rejects a profile registration.
    if hermes_home_key(get_hermes_home()) != hermes_home_key(get_process_hermes_home()):
        return
    # The deployment profile disables stock auth plugins; only this offer can
    # supply the Web Access listener's provider. Do not depend on load order.
    listener_client.offer(_swap_provider)
    try:
        provider = _build_provider()
    except (ValueError, SkipRegistration):
        # A forced reload after configuration removal must not keep an older
        # authorized provider alive. Do not print subjects or client settings.
        current = get_provider(OwnerNousProvider.name)
        if current is not None:
            unregister_global_provider(OwnerNousProvider.name, current)
        log.info("Sparkie owner sign-in unavailable: protected owner/client setup is incomplete")
        return
    ctx.register_dashboard_auth_provider(provider)
