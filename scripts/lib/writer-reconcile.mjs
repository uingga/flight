import {execFileSync} from 'node:child_process';
export function reconcilePublication({root,localCommit,commitSha,repository,fixtureRemote=false}){
 if(![localCommit,commitSha].every(v=>/^[a-f0-9]{40}$/.test(v||'')))throw Error('invalid reconciliation identity');
 const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const clean=()=>{if(git(['status','--porcelain','--untracked-files=no'])||git(['rev-parse','HEAD'])!==localCommit)throw Error('working copy changed; preserve publication and stop');};
 clean();
 try{git(['cat-file','-e',commitSha+'^{commit}']);}catch{
  const origin=git(['remote','get-url','origin']),url=new URL(origin);
  const fixture=fixtureRemote&&url.protocol==='http:'&&['127.0.0.1','[::1]'].includes(url.hostname);
  const approved=/^[\w.-]+\/[\w.-]+$/.test(repository||'')&&url.protocol==='https:'&&url.hostname==='github.com'&&!url.port&&url.pathname.replace(/\.git$/,'')==='/'+repository;
  if(url.username||url.password||url.search||url.hash||(!fixture&&!approved))throw Error('publication fetch origin refused');
  // Fetch only the exact broker result; no merge, FETCH_HEAD, tags or remote ref update.
  git(['-c','protocol.file.allow=never','-c','protocol.ext.allow=never','-c','http.followRedirects=false','fetch','--no-tags','--no-write-fetch-head','--no-auto-maintenance','origin',commitSha]);
  git(['cat-file','-e',commitSha+'^{commit}']);
 }
 if(git(['rev-parse',localCommit+'^{tree}'])!==git(['rev-parse',commitSha+'^{tree}']))throw Error('publication tree differs; preserve local commit');
 if(localCommit!==commitSha&&git(['show','-s','--format=%P',localCommit])!==git(['show','-s','--format=%P',commitSha]))throw Error('publication parent differs');
 const branch=git(['symbolic-ref','HEAD']);
 if(!branch.startsWith('refs/heads/'))throw Error('named local branch required');
 git(['update-ref',`refs/tikitikit-publication/${localCommit}`,localCommit]);
 clean();
 // Identical trees: no checkout/reset and no working files or index are written.
 git(['update-ref',branch,commitSha,localCommit]);
}
