import { runReport, type Ga4Config, type ReportRequest, type ReportResponse } from '../ga4';
import { classifyAcquisition, acquisitionSourceKey, acquisitionSourceLabel, completeAcquisitionReport, type AcquisitionData, type AcquisitionGroup, type AcquisitionSource } from '../acquisition';
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
        // Several GA source strings can describe one service. Query their exact union:
        // adding user counts (or sessions spanning source rows) would overcount.
        const mergedTotals = new Map<string, Promise<{sessions:number;users:number}>>();
        const normalize = async <T extends AcquisitionSource>(entries:T[], category?:string):Promise<T[]> => {
            const aliases = new Map<string,T[]>();
            for (const entry of entries) {
                const key=acquisitionSourceKey(entry.source);
                aliases.set(key,[...(aliases.get(key)||[]),entry]);
            }
            const result:T[]=[];
            for(const [key,items] of Array.from(aliases)) {
                const rawSources=Array.from(new Set(items.map(item=>item.source)));
                const merged={...items[0],source:key,label:acquisitionSourceLabel(key),rawSources};
                if ('categories' in merged) (merged as T & {categories:string[]}).categories=Array.from(new Set(items.flatMap(item=>(item as T & {categories:string[]}).categories)));
                if(items.length>1) {
                    const tuples=Array.from(buckets).filter(([label])=>!category||label===category).flatMap(([,rows])=>rows).filter(row=>rawSources.includes(row.tuple[1])).map(row=>row.tuple);
                    const identity=JSON.stringify(tuples);
                    if(!mergedTotals.has(identity)) mergedTotals.set(identity,(async()=>{
                        if(tuples.length>500)throw Error('Alias group exceeds exact aggregation limit');
                        const report=await query(config,{dateRanges,metrics,limit:1,
                            dimensionFilter:{orGroup:{expressions:tuples.map(tuple=>({andGroup:{expressions:tuple.map((value,i)=>({filter:{fieldName:dimensions[i],stringFilter:{value,matchType:'EXACT',caseSensitive:true}}}))}}))}}});
                        if(!completeAcquisitionReport(report)||report.rows?.length!==1)throw Error('Incomplete alias totals');
                        const [sessions,users]=report.rows[0].metricValues?.map(v=>Number(v.value))||[];
                        if(!Number.isSafeInteger(sessions)||sessions<Math.max(...items.map(i=>i.sessions))||sessions>items.reduce((n,i)=>n+i.sessions,0)||!Number.isSafeInteger(users)||users<0)throw Error('Invalid alias totals');
                        return {sessions,users};
                    })());
                    Object.assign(merged,await mergedTotals.get(identity));
                }
                result.push(merged);
            }
            return result.sort((a,b)=>b.sessions-a.sessions||a.source.localeCompare(b.source));
        }
        const normalizedSources=await normalize(sourceRows);
        for(const group of groups)group.sources=await normalize(group.sources,group.label);
        return {available:true,sourceRows:normalizedSources,groups:groups.sort((a,b)=>b.sessions-a.sessions||a.label.localeCompare(b.label))};
    } catch { return unavailable(); }
}
