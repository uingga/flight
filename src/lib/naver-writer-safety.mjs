// Production requires a verified, scope-bound remote authority. Booleans are not proof.
import {requireAuthority} from './writer-authority.mjs';
export function requireExternalWriterControl(proof,scope) {
    if(proof){requireAuthority(proof,scope);return;}
    throw Error('external Git write authority is unverified; coordinated production execution refused');
}
export function legacyWriterAdmission(env=process.env) {
    if(env.NAVER_COORDINATION==='1')throw Error('legacy writer cannot participate in coordinated publication');
}
