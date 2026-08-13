import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { getProfilePhotoDisplayUrl, removeProfilePhoto, uploadProfilePhoto } from '@/app/lib/profilePhoto'

export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    const eligibleRoles = ['reseller', 'regional', 'provincial', 'city', 'admin']
    if (!user || user.is_staff || !eligibleRoles.includes(user.role)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { profile_photo } = await req.json()
    if (typeof profile_photo !== 'string' || !profile_photo.startsWith('data:image/')) return NextResponse.json({ error: 'Choose a valid JPEG, PNG, or WebP image.' }, { status: 400 })
    const previous = await prisma.user.findUnique({ where: { id: user.id }, select: { profile_photo: true } })
    const storedPhoto = await uploadProfilePhoto(user.id, profile_photo)
    const updated = await prisma.user.update({ where: { id: user.id }, data: { profile_photo: storedPhoto }, select: { profile_photo: true } })
    if (previous?.profile_photo && previous.profile_photo !== storedPhoto) await removeProfilePhoto(previous.profile_photo)
    return NextResponse.json({ success: true, profile_photo: await getProfilePhotoDisplayUrl(updated.profile_photo) })
  } catch (error) {
    console.error('[PROFILE PHOTO ERROR]', error)
    return NextResponse.json({ error: 'Unable to update the profile photo.' }, { status: 500 })
  }
}
