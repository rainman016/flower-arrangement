import {preview} from 'vite'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'

// One bounded local server and one browser. Always close the server, including
// when the browser verifier rejects an assertion or a load fails unexpectedly.
const server=await preview({preview:{host:'127.0.0.1',port:0,open:false}})
try{
  const url=server.resolvedUrls.local[0]
  const {stdout,stderr}=await promisify(execFile)(process.execPath,['scripts/verify-scene-entry.mjs',url],{windowsHide:true,maxBuffer:1024*1024})
  process.stdout.write(stdout);process.stderr.write(stderr)
}finally{await new Promise(done=>server.httpServer.close(done))}
