import asyncio, json, os
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock
from telegram import Update
from gateway.config import PlatformConfig
from plugins.platforms.telegram.adapter import TelegramAdapter
from sparkie_sparks.sandbox_provider import SparkComputeProvider
from tools.credential_files import iter_cache_files

async def main():
 adapter=TelegramAdapter(PlatformConfig(enabled=True, token='fixture',extra={'allow_from':['401'],'unauthorized_dm_behavior':'ignore'}))
 adapter.handle_message=AsyncMock()
 result=[]
 for i,(sender,caption,name,raw,inline) in enumerate([
    (401,'Please read it.','memo.txt',b'EVIDENCE-MALLOW-7249',True),
    (401,'/goal check it','command.txt',b'EVIDENCE-COMMAND-5621',False),
    (401,'Please read it.','big.txt',b'Q'*(102400+1),False),
    (401,'Please read it.','invalid.txt',b'\xff\xfe',False),
    (402,'Please read it.','denied.txt',b'DENIED-MARKER',False)]):
  bot=MagicMock(); bot.defaults=None
  file=MagicMock();file.file_path='documents/'+name
  file.download_as_bytearray=AsyncMock(return_value=bytearray(raw))
  bot.get_file=AsyncMock(return_value=file)
  update=Update.de_json({'update_id':10+i,'message':{'message_id':10+i,'date':1700000000,'chat':{'id':sender,'type':'private','first_name':'Example'},'from':{'id':sender,'is_bot':False,'first_name':'Example'},'caption':caption,'document':{'file_id':'synthetic-'+str(i),'file_unique_id':'unique-'+str(i),'file_name':name,'mime_type':'text/plain','file_size':len(raw)}}},bot)
  adapter.handle_message.reset_mock()
  await adapter._handle_media_message(update,MagicMock())
  if sender==402:
   assert not adapter.handle_message.called and not bot.get_file.called
   result.append(dict(file=name,admitted=False,download_calls=bot.get_file.await_count));continue
  event=adapter.handle_message.await_args.args[0]
  assert event.media_text_inlined==[inline] and caption in event.text
  prefix='[Content of '+name+']'
  assert (prefix in event.text)==inline
  assert len(event.media_urls)==1 and Path(event.media_urls[0]).read_bytes()==raw
  entries=iter_cache_files(SparkComputeProvider.cache_path_base)
  path=next(e['container_path'] for e in entries if e['host_path']==event.media_urls[0])
  assert path.startswith('/home/sandbox/.hermes/cache/documents/')
  result.append(dict(file=name,admitted=True,download_calls=bot.get_file.await_count,bytes=len(raw),inline=inline,marker_in_event='EVIDENCE-MALLOW-7249' in event.text,caption_preserved=True,cached_bytes=True,remote_directory=str(Path(path).parent)))
 print(json.dumps(result))
asyncio.run(main())
