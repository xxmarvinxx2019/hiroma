import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

const outletFields = {
  fulfillment_outlet_name: true,
  fulfillment_outlet_address: true,
  fulfillment_outlet_region_code: true,
  fulfillment_outlet_region_name: true,
  fulfillment_outlet_province_code: true,
  fulfillment_outlet_province_name: true,
  fulfillment_outlet_city_muni_code: true,
  fulfillment_outlet_city_muni_name: true,
  fulfillment_outlet_barangay_code: true,
  fulfillment_outlet_barangay_name: true,
  fulfillment_outlet_zip_code: true,
} as const

export async function GET() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'city') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const profile = await prisma.distributorProfile.findUnique({ where: { user_id: user.id }, select: outletFields })
  return NextResponse.json({ outlet: profile || null })
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { address, fulfillment_outlet } = await req.json()

    if (fulfillment_outlet !== undefined) {
      const outlet = fulfillment_outlet as Record<string, string>
      const hasOutlet = Boolean(outlet?.street?.trim() || outlet?.barangay_name?.trim() || outlet?.city_muni_name?.trim())
      const required = ['street', 'barangay_code', 'barangay_name', 'city_muni_code', 'city_muni_name', 'province_code', 'province_name', 'region_code', 'region_name', 'zip_code']
      if (hasOutlet && required.some((key) => !outlet?.[key]?.trim())) {
        return NextResponse.json({ error: 'Please complete the outlet street, barangay, city/municipality, province, region, and ZIP code.' }, { status: 400 })
      }
      if (hasOutlet && !/^\d{4}$/.test(outlet.zip_code.trim())) {
        return NextResponse.json({ error: 'Outlet ZIP code must have 4 digits.' }, { status: 400 })
      }
      const profile = await prisma.distributorProfile.update({
        where: { user_id: user.id },
        data: hasOutlet ? {
          fulfillment_outlet_name: outlet.name?.trim() || null,
          fulfillment_outlet_address: [outlet.street.trim(), outlet.barangay_name.trim(), outlet.city_muni_name.trim(), outlet.province_name.trim(), outlet.region_name.trim(), outlet.zip_code.trim()].join(', '),
          fulfillment_outlet_region_code: outlet.region_code.trim(), fulfillment_outlet_region_name: outlet.region_name.trim(),
          fulfillment_outlet_province_code: outlet.province_code.trim(), fulfillment_outlet_province_name: outlet.province_name.trim(),
          fulfillment_outlet_city_muni_code: outlet.city_muni_code.trim(), fulfillment_outlet_city_muni_name: outlet.city_muni_name.trim(),
          fulfillment_outlet_barangay_code: outlet.barangay_code.trim(), fulfillment_outlet_barangay_name: outlet.barangay_name.trim(), fulfillment_outlet_zip_code: outlet.zip_code.trim(),
        } : {
          fulfillment_outlet_name: null, fulfillment_outlet_address: null, fulfillment_outlet_region_code: null, fulfillment_outlet_region_name: null,
          fulfillment_outlet_province_code: null, fulfillment_outlet_province_name: null, fulfillment_outlet_city_muni_code: null, fulfillment_outlet_city_muni_name: null,
          fulfillment_outlet_barangay_code: null, fulfillment_outlet_barangay_name: null, fulfillment_outlet_zip_code: null,
        },
        select: outletFields,
      })
      return NextResponse.json({ success: true, outlet: profile })
    }

    if (typeof address !== 'string') return NextResponse.json({ error: 'Address is required.' }, { status: 400 })
    const updated = await prisma.user.update({
      where: { id: user.id }, data: { address: address.trim() || null },
      select: { id: true, full_name: true, username: true, email: true, mobile: true, address: true, distributor_profile: { select: { coverage_area: true, dist_level: true } } },
    })
    return NextResponse.json({ success: true, user: updated })
  } catch (error) {
    console.error('[CITY PROFILE PATCH ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
