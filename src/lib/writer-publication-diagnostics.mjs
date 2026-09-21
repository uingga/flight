// Deliberately omit messages, response bodies, URLs and credentials from diagnostics.
const codes=new Set(['ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOTFOUND','EAI_AGAIN','EPIPE','ENOBUFS',
 'HTTP_TIMEOUT','HTTP_RESPONSE_TOO_LARGE','HTTP_REDIRECT_REFUSED','HTTP_RESPONSE_FAILED','HTTP_REQUEST_FAILED',
 'WRITER_TRANSPORT_ERROR','WRITER_RESPONSE_INVALID','WRITER_PUBLICATION_REFUSED','WRITER_RELAY_UNAVAILABLE','WRITER_HTTP_REFUSED','WRITER_OUTCOME_UNKNOWN']);
const status=value=>Number.isInteger(value)&&value>=100&&value<=599?value:null;
export function publicationDiagnostic(error){
 return {event:'writer-publication-error',outcome:['unknown','refused'].includes(error?.publicationOutcome)?error.publicationOutcome:'unknown',
  code:codes.has(error?.code)?error.code:null,httpStatus:status(error?.httpStatus),
  lastCode:codes.has(error?.lastCode)?error.lastCode:null,lastHttpStatus:status(error?.lastHttpStatus),
  requestId:/^[a-zA-Z0-9-]{16,80}$/.test(error?.requestId||'')?error.requestId:null,
  receiptAccepted:error?.receiptAccepted===true,newRequestAllowed:false};
}
export function publicationFailureMessage(error){
 return publicationDiagnostic(error).outcome==='unknown'
  ?'writer publication outcome unknown; retain collected data and reconcile the same receipt; no alternate push'
  :'writer publication refused; no alternate push';
}
