import {gzipSync,gunzipSync} from 'node:zlib';
export const WIRE_LIMIT=3*1024*1024;
export function encodeRelayWire(text){
 if(Buffer.byteLength(text)>64*1024*1024)throw Error('decoded relay payload too large');
 const encoded=JSON.stringify({encoding:'tikit-gzip-v1',body:gzipSync(text).toString('base64')});
 if(Buffer.byteLength(encoded)>WIRE_LIMIT)throw Error('relay wire payload too large');
 return encoded;
}
export function decodeRelayWire(text){
 if(Buffer.byteLength(text)>WIRE_LIMIT)throw Error('relay wire payload too large');
 const value=JSON.parse(text);
 if(value.encoding!=='tikit-gzip-v1'||typeof value.body!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(value.body))throw Error('invalid relay envelope');
 return gunzipSync(Buffer.from(value.body,'base64'),{maxOutputLength:64*1024*1024}).toString('utf8');
}
