export type BinaryCapPolicy = { mode: 'two_sessions' | 'daily_anytime'; daily_limit: number; first_limit: number | null; cutoff_minute: number | null }
export function validateBinaryCapPolicy(input: unknown): BinaryCapPolicy {
 if (!input || typeof input !== 'object') throw new Error('A cap policy is required.')
 const p=input as Record<string,unknown>
 if(p.mode!=='two_sessions'&&p.mode!=='daily_anytime') throw new Error('Choose Daily anytime or Two sessions.')
 if(typeof p.daily_limit!=='number'||!Number.isInteger(p.daily_limit)||p.daily_limit<1||p.daily_limit>10000) throw new Error('Daily maximum must be a whole number from 1 to 10000.')
 if(p.mode==='daily_anytime') {
  if(p.first_limit!==null||p.cutoff_minute!==null) throw new Error('Daily anytime has no session limits or cutoff.')
  return {mode:p.mode,daily_limit:p.daily_limit,first_limit:null,cutoff_minute:null}
 }
 if(typeof p.first_limit!=='number'||!Number.isInteger(p.first_limit)||p.first_limit<1||p.first_limit>=p.daily_limit) throw new Error('Each session must have a positive allowance; their sum must equal the daily maximum.')
 if(typeof p.cutoff_minute!=='number'||!Number.isInteger(p.cutoff_minute)||p.cutoff_minute<1||p.cutoff_minute>1439) throw new Error('Choose a cutoff between 00:01 and 23:59 Philippine time.')
 return {mode:p.mode,daily_limit:p.daily_limit,first_limit:p.first_limit,cutoff_minute:p.cutoff_minute}
}
export function validateBinaryCapDate(value: unknown) {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value) throw new Error('Choose a valid effective date.')
 return value
}

export function validateCarryoverPolicy(input: unknown): {enabled:boolean;max_points:number} {
 if(!input||typeof input!=='object')throw new Error('Unmatched point cap settings are required.')
 const p=input as Record<string,unknown>
 if(typeof p.enabled!=='boolean'||typeof p.max_points!=='number'||!Number.isInteger(p.max_points)||p.max_points<1||p.max_points>2147483647)throw new Error('Choose on/off and a whole unmatched-point limit from 1 to 2147483647.')
 return {enabled:p.enabled,max_points:p.max_points}
}
