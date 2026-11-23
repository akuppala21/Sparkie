"""Drive an admitted synthetic Telegram /stop into each native active-turn handler."""
import asyncio, json
from unittest.mock import AsyncMock, MagicMock
from telegram import Update
from gateway.config import PlatformConfig
from gateway.run import GatewayRunner
from gateway.session import build_session_key
from plugins.platforms.telegram.adapter import TelegramAdapter

async def main():
    adapter=TelegramAdapter(PlatformConfig(enabled=True,token='fixture',extra={'allow_from':['401'],'unauthorized_dm_behavior':'ignore'}))
    results=[]
    for sender,busy in [(402,True),(401,True),(401,False)]:
        async def route(event):
            own=build_session_key(event.source)
            runner=object.__new__(GatewayRunner)
            runner._interrupt_and_clear_session=AsyncMock()
            runner._running_agents={own:object()}
            runner.adapters={}
            runner._hm_stop_owner_turn=AsyncMock()
            runner._is_user_authorized_for_source=lambda *args,**kwargs:True
            if busy:
                reply=await runner._busy_stop_command(event,own,event.source)
            else:
                runner.session_store=MagicMock()
                runner.session_store.get_or_create_session.return_value=type("Session",(),{"session_key":own})()
                reply=await runner._handle_stop_command(event)
            assert runner._interrupt_and_clear_session.await_count==1
            assert 'Agent response stopped.' in reply and 'check its workspace' in reply
            results.append({'path':'busy' if busy else 'active_dispatch','reply':str(reply),'interrupt_requests':1})
            return reply
        adapter.set_message_handler(route)
        adapter._send_with_retry=AsyncMock(return_value=type("Recorded",(),{"success":True,"message_id":None})())
        adapter.handle_message=AsyncMock(side_effect=adapter._dispatch_inline_reply)
        bot=MagicMock();bot.defaults=None
        data={'update_id':1,'message':{'message_id':1,'date':1700000000,'chat':{'id':sender,'type':'private','first_name':'Fixture'},'from':{'id':sender,'is_bot':False,'first_name':'Fixture'},'entities':[{'type':'bot_command','offset':0,'length':5}],'text':'/stop'}}
        await adapter._handle_command(Update.de_json(data,bot),MagicMock())
        assert adapter.handle_message.await_count == (1 if sender==401 else 0)
        assert adapter._send_with_retry.await_count == (1 if sender==401 else 0)
        if sender==401:
            sent=adapter._send_with_retry.await_args.kwargs
            assert sent['content'] == results[-1]['reply'] and str(sent['chat_id'])==str(sender)
            results[-1]['adapter_send_captured']=True
        if sender==402:results.append({'path':'unlisted_sender','handler_calls':0})
    print(json.dumps(results,indent=2))
asyncio.run(main())
