// Test-only adapter exercises the actual public selectors without duplicating SQL.
import app,{publicRooms,inactiveListing,type Bindings} from '../apps/api/src/index';
export default {
 async fetch(request:Request,env:Bindings,ctx:ExecutionContext){
  const path=new URL(request.url).pathname;
  if(path==='/__test/public')return Response.json(await publicRooms(env.DB));
  if(path.startsWith('/__test/inactive/'))return Response.json(await inactiveListing(env.DB,path.slice('/__test/inactive/'.length)));
  return app.fetch(request,env,ctx);
 }
};
