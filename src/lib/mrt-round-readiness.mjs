// Align every general agency round with the preceding MyRealTrip collection.
const KST_OFFSET = 9 * 3600000;
const MINUTE = 60000;
export const MRT_ALIGNED_ROUNDS = Object.freeze([
    Object.freeze({generalMinute:6*60+17, startMinute:5*60, host:'github'}),
    Object.freeze({generalMinute:10*60+12, startMinute:8*60+55, host:'C'}),
    Object.freeze({generalMinute:13*60+23, startMinute:12*60+5, host:'github'}),
    Object.freeze({generalMinute:16*60+31, startMinute:15*60+15, host:'C'}),
    Object.freeze({generalMinute:19*60+31, startMinute:19*60+15, host:'B'}),
]);
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
