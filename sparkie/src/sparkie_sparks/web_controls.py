"""Native authenticated routes. No separate sign-in or model confirmation tool."""

from typing import Literal
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool
import re

from .controls import configured
from .memory_controls import ERASE_ACTION, default_profile

router = APIRouter()


class Prepare(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    request_id: str = Field(pattern=r'^[a-f0-9]{32}$')
    action: Literal['wake', 'sleep', 'stop_workload', 'start_service', 'stop_service']
    spark: Literal['spark2', 'spark3', 'spark4']
    container: str | None = Field(default=None, pattern=r'^[a-f0-9]{64}$')
    recipe: str | None = Field(default=None, pattern=r'^[a-z][a-z0-9-]{0,47}$')
    revision: str | None = Field(default=None, pattern=r'^[a-f0-9]{64}$')
    instance: str | None = Field(default=None, pattern=r'^[a-f0-9]{32}$')


class Confirmation(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    digest: str = Field(pattern=r'^[a-f0-9]{64}$')


class PrepareUpdate(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    request_id: str = Field(pattern=r'^[a-f0-9]{32}$')
    proposal: str = Field(pattern=r'^[a-f0-9]{64}$')


def _call(request, callback):
    try:
        controls = configured()
        # The native gate must have attached a verified session. Token-tool principals,
        # an open loopback listener, and identity fields in a request body do not qualify.
        owner = controls.binding().web(request)
        return callback(controls, owner)
    except PermissionError as exc:
        raise HTTPException(403, detail=str(exc)) from None
    except ValueError as exc:
        raise HTTPException(400, detail=str(exc)) from None
    except RuntimeError as exc:
        raise HTTPException(409, detail=str(exc)) from None


@router.get('/controls')
def capabilities(request: Request):
    try:
        configured()
    except RuntimeError:
        return {'available': False, 'message': 'Spark controls are not connected yet. Observations are still available.'}
    return _call(request, lambda controls, owner: controls.capabilities(owner))


@router.post('/operations')
def prepare(request: Request, body: Prepare):
    return _call(request, lambda controls, owner: controls.prepare(
        owner, request_key='web:' + body.request_id, request_ref='web:' + body.request_id,
        **body.model_dump(exclude={'request_id'}, exclude_none=True)))


@router.get('/services')
def services(request: Request):
    from .service_access import public_link
    def catalog(controls, owner):
        rows = controls.service_catalog(owner)
        result = []
        for row in rows:
            try:
                link = public_link(row['recipe'])
            except RuntimeError:
                link = None
            result.append({**row, 'url': link})
        return result
    return _call(request, catalog)


@router.post('/updates')
def prepare_update(request: Request, body: PrepareUpdate):
    reference = 'web:update:' + body.request_id
    return _call(request, lambda controls, owner: controls.prepare_update(
        owner, request_key=reference, request_ref=reference, proposal=body.proposal))


@router.get('/services/{recipe}/logs')
def service_logs(request: Request, recipe: str, instance: str):
    return _call(request, lambda controls, owner: controls.service_logs(owner, recipe=recipe, instance=instance))


@router.get('/services/{recipe}/open')
def open_service(request: Request, recipe: str, instance: str | None = None):
    from .service_access import public_link
    def resolve(controls, owner):
        # Establish the checked private forward before presenting the link.
        route = controls.service_route(owner, recipe=recipe, instance=instance)
        link = public_link(recipe) + ('v1/models' if route['kind'] == 'model' else '')
        return RedirectResponse(link, status_code=303,
                                headers={'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'})
    return _call(request, resolve)


@router.get('/services/{recipe}/authorize')
def authorize_service(request: Request, recipe: str):
    from .service_access import verify_proxy_request
    def authorize(controls, owner):
        verify_proxy_request(request)
        route = controls.service_route(owner, recipe=recipe)
        if (not isinstance(route, dict) or type(route.get('port')) is not int
                or not 1024 <= route['port'] <= 65535 or route.get('kind') not in ('app', 'model')):
            raise RuntimeError('This service is not ready to open.')
        verify_proxy_request(request, kind=route['kind'], recipe=recipe)
        # Only the protected ingress consumes this header. Never accept a URL or
        # host supplied by the browser or pass owner credentials to the workload.
        return Response(status_code=204, headers={'X-Sparkie-Port': str(route['port']),
                                                'Cache-Control': 'no-store'})
    return _call(request, authorize)


@router.post('/memory/erase')
async def prepare_memory(request: Request):
    # A validation error must not send the private literal back with its input.
    try:
        body = await request.json()
    except (ValueError, UnicodeError):
        raise HTTPException(400, detail='Enter the exact text from one memory entry.') from None

    def prepare(controls, owner):
        default_profile(request.query_params.get('profile', ''))
        if (not isinstance(body, dict) or set(body) != {'request_id', 'target', 'literal'}
                or not isinstance(body['request_id'], str) or not re.fullmatch('[a-f0-9]{32}', body['request_id'])):
            raise ValueError('Enter the exact text from one memory entry.')
        reference = 'web:memory:' + body['request_id']
        return controls.prepare_memory(owner, request_key=reference, request_ref=reference,
                                       target=body['target'], literal=body['literal'])

    return await run_in_threadpool(_call, request, prepare)


@router.get('/operations/{operation}')
def get_operation(request: Request, operation: str):
    return _call(request, lambda controls, owner: controls.get(owner, operation))


@router.post('/operations/{operation}/confirm')
def confirm(request: Request, operation: str, body: Confirmation):
    def execute(controls, owner):
        profile = request.query_params.get('profile', '')
        if profile not in ('', 'default') and controls.get(owner, operation)['intent']['action'] == ERASE_ACTION:
            default_profile(profile)
        return controls.confirm(owner, operation, body.digest)
    return _call(request, execute)


@router.post('/operations/{operation}/cancel')
def cancel(request: Request, operation: str):
    return _call(request, lambda controls, owner: controls.cancel(owner, operation))


@router.post('/operations/{operation}/accept_update')
def accept_update(request: Request, operation: str, body: Confirmation):
    return _call(request, lambda controls, owner: controls.accept_update(owner, operation, body.digest))


@router.post('/operations/{operation}/rollback_update')
def rollback_update(request: Request, operation: str, body: Confirmation):
    return _call(request, lambda controls, owner: controls.rollback_update(owner, operation, body.digest))


@router.post('/operations/{operation}/check')
def check(request: Request, operation: str):
    return _call(request, lambda controls, owner: controls.check(owner, operation))
