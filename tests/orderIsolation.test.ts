import assert from 'node:assert/strict'
import test from 'node:test'
import { cityOrderListScope, orderParticipantScope, recommendFulfillmentDistributor } from '../src/app/lib/orderSecurity'

test('city reseller-order searches remain assigned-seller scoped', () => {
  assert.deepEqual(cityOrderListScope('city-a', 'reseller_orders'), { seller_id: 'city-a' })
  assert.deepEqual(cityOrderListScope('city-b', 'reseller_orders'), { seller_id: 'city-b' })
  assert.deepEqual(cityOrderListScope('city-a', 'my_orders'), { buyer_id: 'city-a' })
})

test('non-admin order detail access is limited to buyer or assigned seller', () => {
  assert.deepEqual(orderParticipantScope('city-a', 'city'), { OR: [{ buyer_id: 'city-a' }, { seller_id: 'city-a' }] })
  assert.deepEqual(orderParticipantScope('reseller-a', 'reseller'), { OR: [{ buyer_id: 'reseller-a' }, { seller_id: 'reseller-a' }] })
  assert.deepEqual(orderParticipantScope('admin-a', 'admin'), {})
})

test('server recommendation assigns the exact delivery-area distributor only', () => {
  const candidates = [
    { id: 'city-a', full_name: 'Cebu A', region_name: 'Region VII', province_name: 'Cebu', city_muni_name: 'Cebu City', barangay_name: 'Lahug', coverage_area: 'Cebu City' },
    { id: 'city-b', full_name: 'Cebu B', region_name: 'Region VII', province_name: 'Cebu', city_muni_name: 'Mandaue City', barangay_name: 'Banilad', coverage_area: 'Mandaue City' },
  ]
  const result = recommendFulfillmentDistributor(candidates, 'city-b', { address: 'Lahug, Cebu City', region: 'Region VII', province: 'Cebu', city: 'Cebu City', barangay: 'Lahug' })
  assert.equal(result?.distributor.id, 'city-a')
  assert.equal(result?.basis, 'exact_barangay')
})

test('assigned distributor is the safe fallback when address has no match', () => {
  const candidates = [
    { id: 'city-a', full_name: 'Distributor A', coverage_area: 'Cebu' },
    { id: 'city-b', full_name: 'Distributor B', coverage_area: 'Davao' },
  ]
  assert.equal(recommendFulfillmentDistributor(candidates, 'city-b', { address: 'Unknown' })?.distributor.id, 'city-b')
})
