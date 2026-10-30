"""Taste inspection of authenticated UI through a GET-only local proxy. Disposable local state."""
import hashlib,http.client,http.server,json,os,secrets,shutil,signal,subprocess,tempfile,threading,time,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
STATE=Path(tempfile.mkdtemp(prefix='account-inspect-',dir=ROOT/'.cache'));LOG=(STATE/'preview.log').open('w');token=secrets.token_hex(32);uid=str(uuid.uuid4());aid=str(uuid.uuid4())
process=subprocess.Popen(['node','scripts/run-tool.mjs','node','scripts/preview.mjs','--state',str(STATE/'state'),'--port','4329'],cwd=ROOT,stdout=LOG,stderr=LOG,start_new_session=True)
class Proxy(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  connection=http.client.HTTPConnection('127.0.0.1',4329,timeout=30)
  try:
   connection.request('GET',self.path,headers={'Cookie':'tpt_session='+token});r=connection.getresponse();body=r.read();self.send_response(r.status)
   for key,value in r.getheaders():
    if key.lower() not in ['connection','content-length','transfer-encoding','set-cookie','content-encoding']:self.send_header(key,value)
   self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
  finally:connection.close()
 def do_POST(self):self.send_error(405)
 def do_PATCH(self):self.send_error(405)
 def do_DELETE(self):self.send_error(405)
proxy=None
try:
 for i in range(120):
  try:
   c=http.client.HTTPConnection('127.0.0.1',4329,timeout=1);c.request('GET','/api/health');r=c.getresponse();r.read();c.close()
   if r.status==200:break
  except Exception:pass
  time.sleep(.5)
 else:raise RuntimeError('Local inspector preview unavailable')
 fixture=STATE/'fixture.sql';fixture.write_text(f"""INSERT INTO users(id,email,name,password_hash,is_super_admin) VALUES('{uid}','nhatminh@example.test','Nhật Minh','fixture-only',0),('{aid}','reviewer@example.test','Quản trị viên','fixture-only',1);
 INSERT INTO sessions(token_hash,user_id,expires_at) VALUES('{hashlib.sha256(token.encode()).hexdigest()}','{uid}',unixepoch()+3600);
 INSERT INTO posting_promotions(user_id) VALUES('{uid}');
 INSERT INTO seller_profiles(user_id,display_name,seller_type,phone,zalo_phone,introduction,status,version,change_token) VALUES('{uid}','Nhật Minh','owner','0901234567','0901234567','Cho thuê phòng tại Bình Thạnh và Thủ Đức. Hỗ trợ hẹn xem phòng trực tiếp.','approved',2,'fixture');
 INSERT INTO seller_reviews(id,user_id,reviewer_id,decision,note,profile_version) VALUES('{uuid.uuid4()}','{uid}','{aid}','approved','Thông tin liên hệ đã đầy đủ.',1);
 """)
 r=subprocess.run(['node','scripts/run-tool.mjs','npm','exec','--workspace=@timphongtro/web','--','wrangler','d1','execute','DB','--local','--config',str(ROOT/'apps/web/dist/server/wrangler.json'),'--persist-to',str(STATE/'state'),'--file',str(fixture)],cwd=ROOT,capture_output=True,text=True)
 if r.returncode:raise RuntimeError('Inspector fixture failed')
 fixture.unlink();proxy=http.server.ThreadingHTTPServer(('127.0.0.1',4330),Proxy);threading.Thread(target=proxy.serve_forever,daemon=True).start()
 from playwright.sync_api import sync_playwright
 with sync_playwright() as playwright:
  browser=playwright.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);page=browser.new_page(viewport={'width':320,'height':900});page.goto('http://127.0.0.1:4330/tai-khoan/tin-dang/moi');page.wait_for_timeout(300);measurement=page.evaluate("({width:innerWidth,scroll:document.documentElement.scrollWidth,bad:[...document.querySelectorAll('body *')].map(e=>({tag:e.tagName,cls:e.className,x:e.getBoundingClientRect().x,width:e.getBoundingClientRect().width,scroll:e.scrollWidth})).filter(e=>e.x+e.width>321||e.x<0).slice(0,25)})");(ROOT/'.cache'/'posting-320-measurement.json').write_text(json.dumps(measurement,indent=2));browser.close()
 skill='/tmp/taste-skill-reference.G2uato/skills/taste-skill/scripts/inspect.mjs'
 for path,label in [('/tai-khoan/ho-so','profile-inspect'),('/tai-khoan/tin-dang/moi','posting-inspect')]:
  result=subprocess.run(['node',skill,'http://127.0.0.1:4330'+path,'--app','--out','.taste-skill/'+label,'--widths','1440,768,390'],cwd=ROOT,capture_output=True,text=True)
  (ROOT/'.cache'/(label+'.log')).write_text(result.stdout+result.stderr)
  print(label+': inspector completed (report saved)',flush=True)
finally:
 if proxy:proxy.shutdown();proxy.server_close()
 os.killpg(process.pid,signal.SIGTERM)
 try:process.wait(timeout=10)
 except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait()
 LOG.close();shutil.rmtree(STATE);print('Disposed local inspector fixtures and read-only proxy.',flush=True)
