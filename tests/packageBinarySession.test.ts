import test from 'node:test'
import assert from 'node:assert/strict'
import { planPackageBinarySession, planPackageBinaryCarryover } from '../src/app/lib/packageBinarySession'

test('closed session rejects new volume on either leg without consuming old carryover', () => {
  for (const leg of ['left', 'right'] as const) {
    assert.deepEqual(planPackageBinarySession({ left: 300, right: 1200, sourcePoints: 600, leg, pointsPerPair: 600, remainingPairs: 0 }), {
      acceptedPoints: 0, flushedPoints: 600, completedPairs: 0, consumedPoints: 0, leftPoints: 300, rightPoints: 1200,
    })
  }
})

test('transaction reaching the session limit rejects its surplus including unmatched remainder', () => {
  assert.deepEqual(planPackageBinarySession({ left: 200, right: 3000, sourcePoints: 3000, leg: 'left', pointsPerPair: 600, remainingPairs: 1 }), {
    acceptedPoints: 400, flushedPoints: 2600, completedPairs: 1, consumedPoints: 600, leftPoints: 0, rightPoints: 2400,
  })
})

test('open session retains unmatched incoming volume and unlimited mode preserves matching', () => {
  assert.equal(planPackageBinarySession({ left: 0, right: 0, sourcePoints: 600, leg: 'left', pointsPerPair: 600, remainingPairs: 5 }).leftPoints, 600)
  assert.equal(planPackageBinarySession({ left: 0, right: 6000, sourcePoints: 6000, leg: 'left', pointsPerPair: 600, remainingPairs: null }).completedPairs, 10)
})


test('carryover planner preserves matching, caps only new residual volume, and never double-counts flushing',()=>{
 let seed=19
 for(let i=0;i<10000;i++){
  seed=(Math.imul(seed,1664525)+1013904223)>>>0
  const input={left:seed%250000,right:0,sourcePoints:(seed%20000)+1,leg:(seed%2?'left':'right') as 'left'|'right',pointsPerPair:600,remainingPairs:seed%6}
  const session=planPackageBinarySession(input),limited=planPackageBinaryCarryover(input,180000)
  assert.equal(limited.completedPairs,session.completedPairs)
  assert.equal(limited.flushedPoints,limited.sessionFlushedPoints+limited.balanceFlushedPoints)
  assert.equal(input.left+input.right+input.sourcePoints,limited.leftPoints+limited.rightPoints+2*limited.consumedPoints+limited.flushedPoints)
  const closing=input.leg==='left'?limited.leftPoints:limited.rightPoints,opening=input.leg==='left'?input.left:input.right
  assert.ok(closing<=Math.max(180000,opening-limited.consumedPoints))
  assert.equal(planPackageBinaryCarryover(input,null).acceptedPoints,session.acceptedPoints)
 }
 assert.throws(()=>planPackageBinaryCarryover({left:0,right:0,sourcePoints:600,leg:'left',pointsPerPair:600,remainingPairs:5},0))
})
