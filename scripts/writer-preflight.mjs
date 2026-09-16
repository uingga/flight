import {legacyWriterAdmission} from '../src/lib/naver-writer-safety.mjs';
import fs from 'node:fs';
import {createBrokerClient} from '../src/lib/writer-broker-client.mjs';
import {WRITER_FILES} from '../src/lib/writer-broker.mjs';
try {
 const role=process.argv[2];
 if(process.env.NAVER_COORDINATION==='1'&&role) {
  if(!WRITER_FILES[role])throw Error('unknown writer role');
  const token=process.env.TIKIT_WRITER_TOKEN||fs.readFileSync(process.env.TIKIT_WRITER_TOKEN_FILE,'utf8').trim();
  await createBrokerClient({url:process.env.TIKIT_WRITER_URL,token})('readInputs');
 }else legacyWriterAdmission();
}catch{console.error('writer admission refused');process.exitCode=1;}
