import { runReport, type Ga4Config, type ReportRequest, type ReportResponse } from '../ga4';
import { classifyAcquisition, acquisitionSourceLabel, completeAcquisitionReport, type AcquisitionData, type AcquisitionGroup } from '../acquisition';
const dimensions = ['sessionDefaultChannelGroup', 'sessionSource', 'sessionMedium'];
const metrics = [{name:'sessions'}, {name:'activeUsers'}];
const unavailable = (): AcquisitionData => ({available:false,groups:[],message:'유입 기록을 온전히 확인하지 못했습니다. 제한되거나 일부만 조회된 기록으로 순위를 추정하지 않습니다.'});
export async function loadAcquisition(config: Ga4Config, dateRanges: ReportRequest['dateRanges'], query: typeof runReport = runReport): Promise<AcquisitionData> {
    try {
        const combined: ReportResponse = {rows:[]};
        for (let page=0; page<20; page++) {
            const report=await query(config,{dateRanges,dimensions:dimensions.map(name=>({name})),metrics,
                orderBys:dimensions.map(dimensionName=>({dimension:{dimensionName}})),limit:10000,offset:combined.rows!.length});
            if (report.metadata?.dataLossFromOtherRow || report.metadata?.subjectToThresholding || report.metadata?.samplingMetadatas?.length) return unavailable();
            combined.rows!.push(...report.rows || []); combined.rowCount=report.rowCount;
            if (completeAcquisitionReport(combined)) break;
            if (!report.rows?.length) return unavailable();
        }
        if (!completeAcquisitionReport(combined)) return unavailable();
        const buckets=new Map<string, Array<{tuple:string[];sessions:number;users:number}>>();
        for(const row of combined.rows || []) {
            const tuple=dimensions.map((_,i)=>row.dimensionValues?.[i]?.value || '');
            const sessions=Number(row.metricValues?.[0]?.value), users=Number(row.metricValues?.[1]?.value);
            if (!Number.isSafeInteger(sessions)||sessions<0||!Number.isSafeInteger(users)||users<0) return unavailable();
            if(!sessions) continue;
            const label=classifyAcquisition(tuple[0],tuple[1],tuple[2]);
            buckets.set(label,[...(buckets.get(label)||[]),{tuple,sessions,users}]);
        }
        const groups=await Promise.all(Array.from(buckets,async([label,rows]):Promise<AcquisitionGroup>=>{
            const sources=Array.from(new Set(rows.map(r=>r.tuple[1]))).map(source=>{
                const entries=rows.filter(r=>r.tuple[1]===source);
                return {source,label:acquisitionSourceLabel(source),sessions:entries.reduce((s,r)=>s+r.sessions,0),users:entries.length===1?entries[0].users:null};
            });
            const result: AcquisitionGroup={label,sessions:rows.reduce((s,r)=>s+r.sessions,0),users:rows.length===1?rows[0].users:null,sources};
            // Unique users cannot be summed across source/medium/channel rows.
            // Query each group's exact tuple union; GA computes its deduplicated total.
            if(rows.length>1 && rows.length<=500) try {
                const report=await query(config,{dateRanges,dimensions:[{name:'sessionSource'}],metrics,metricAggregations:['TOTAL'],limit:10000,
                    dimensionFilter:{orGroup:{expressions:rows.map(({tuple})=>({andGroup:{expressions:tuple.map((value,i)=>({filter:{fieldName:dimensions[i],stringFilter:{value,matchType:'EXACT',caseSensitive:true}}}))}}))}}});
                const total=report.totals?.[0]?.metricValues;
                if(completeAcquisitionReport(report) && Number(total?.[0]?.value)===result.sessions) {
                    const n=Number(total?.[1]?.value);
                    if(Number.isSafeInteger(n)&&n>=0) result.users=n;
                    for(const source of sources) {
                        const matching=(report.rows||[]).filter(r=>r.dimensionValues?.[0]?.value===source.source);
                        const n=Number(matching[0]?.metricValues?.[1]?.value);
                        if(matching.length===1 && Number(matching[0].metricValues?.[0]?.value)===source.sessions && Number.isSafeInteger(n)&&n>=0) source.users=n;
                    }
                }
            } catch { /* Preserve verified sessions, never estimate missing users. */ }
            result.sources.sort((a,b)=>b.sessions-a.sessions||a.source.localeCompare(b.source));
            return result;
        }));
        const sourceRows=Array.from(new Set(groups.flatMap(g=>g.sources.map(s=>s.source)))).map(source=>{
            const entries=groups.flatMap(g=>g.sources.filter(s=>s.source===source).map(s=>({...s,category:g.label})));
            return {source,label:entries[0].label,sessions:entries.reduce((n,s)=>n+s.sessions,0),users:entries.length===1?entries[0].users:null,categories:entries.map(s=>s.category)};
        });
        if(sourceRows.some(s=>s.categories.length>1)) try {
            const report=await query(config,{dateRanges,dimensions:[{name:'sessionSource'}],metrics,limit:10000});
            if(completeAcquisitionReport(report)) for(const source of sourceRows) {
                const matches=(report.rows||[]).filter(r=>r.dimensionValues?.[0]?.value===source.source);
                const users=Number(matches[0]?.metricValues?.[1]?.value);
                if(matches.length===1 && Number(matches[0].metricValues?.[0]?.value)===source.sessions && Number.isSafeInteger(users)&&users>=0) source.users=users;
            }
        } catch { /* Never sum people across categories. */ }
        sourceRows.sort((a,b)=>b.sessions-a.sessions||a.source.localeCompare(b.source));
        return {available:true,sourceRows,groups:groups.sort((a,b)=>b.sessions-a.sessions||a.label.localeCompare(b.label))};
    } catch { return unavailable(); }
}
