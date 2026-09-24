// Align every general agency round with the preceding MyRealTrip collection.
const KST_OFFSET = 9 * 3600000;
const MINUTE = 60000;
export const MRT_ALIGNED_ROUNDS = Object.freeze([
    Object.freeze({generalMinute:6*60+17, startMinute:6*60+25, host:'github'}),
    Object.freeze({generalMinute:10*60+12, startMinute:9*60+35, host:'C'}),
    Object.freeze({generalMinute:13*60+23, startMinute:12*60+40, host:'github'}),
    Object.freeze({generalMinute:16*60+31, startMinute:15*60+55, host:'C'}),
    Object.freeze({generalMinute:19*60+31, startMinute:18*60+55, host:'B'}),
    Object.freeze({generalMinute:20*60+30, startMinute:21*60, host:'github'}),
]);
export function mrtPcTarget(now=Date.now()) {
    if(!Number.isFinite(now))return null;
    const shifted=new Date(now+KST_OFFSET);
    const day=shifted.toISOString().slice(0,10);
    for(const round of MRT_ALIGNED_ROUNDS.filter(item=>item.host==='B'||item.host==='C')){
        const hour=String(Math.floor(round.startMinute/60)).padStart(2,'0');
        const minute=String(round.startMinute%60).padStart(2,'0');
        const slot=Date.parse(`${day}T${hour}:${minute}:00+09:00`);
        if(now>=slot&&now-slot<15*MINUTE)return {host:round.host,slot:new Date(slot).toISOString()};
    }
    return null;
}
export function mrtRoundForGeneralSlot(generalSlot) {
    const time = typeof generalSlot === 'string' ? Date.parse(generalSlot) : NaN;
    if (!Number.isFinite(time) || time % MINUTE !== 0) throw Error('invalid general slot');
    const shifted = new Date(time + KST_OFFSET);
    const minute = shifted.getUTCHours()*60 + shifted.getUTCMinutes();
    const round = MRT_ALIGNED_ROUNDS.find(x=>x.generalMinute===minute);
    if (!round) throw Error('unknown general slot');
    return {generalSlot:new Date(time).toISOString(),
        expectedAt:new Date(time+(round.startMinute-minute)*MINUTE).toISOString(),host:round.host};
}
export function evaluateMrtRoundReadiness({generalSlot,record,observedVersion,now=Date.now(),
    sharedBlocked=false,transportHealthy=true}) {
    const round=mrtRoundForGeneralSlot(generalSlot);
    const deny=reason=>({ready:false,reason});
    if(sharedBlocked)return deny('shared_block');
    if(!transportHealthy)return deny('transport_unknown');
    if(!record)return deny('round_pending');
    if(record.generalSlot!==round.generalSlot || record.expectedAt!==round.expectedAt || record.host!==round.host)
        return deny('round_identity_mismatch');
    if(record.status!=='published')return deny('round_not_published');
    if(typeof record.resultVersion!=='string'||!record.resultVersion||record.resultVersion!==observedVersion)
        return deny('publication_not_observed');
    const completed=Date.parse(record.completedAt),published=Date.parse(record.publishedAt);
    if(!Number.isFinite(now)||!Number.isFinite(completed)||!Number.isFinite(published)
        ||completed<Date.parse(round.expectedAt)||published<completed||published>now)
        return deny('invalid_publication_times');
    return {ready:true,reason:'exact_round_observed'};
}
