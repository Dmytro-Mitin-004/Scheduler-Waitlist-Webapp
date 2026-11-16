import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import bcrypt from 'bcryptjs'
import { encrypt } from '../src/lib/crypto/encrypt'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const OWNER_EMAIL = 'demo@schedulerwaitlist.com'
const CLIENT_EMAIL = 'democlient@schedulerwaitlist.com'
const DEMO_PASSWORD = 'Demo1234!'

async function seed() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12)

  // ── 1. Demo owner (owner_profiles — custom auth, no Supabase Auth user needed) ─
  const { data: existingOwner } = await supabase
    .from('owner_profiles')
    .select('auth_user_id')
    .eq('email', OWNER_EMAIL)
    .maybeSingle()

  let ownerId: string
  if (existingOwner) {
    ownerId = existingOwner.auth_user_id
    console.log('Demo owner already exists:', ownerId)
  } else {
    ownerId = randomUUID()
    const { error } = await supabase.from('owner_profiles').insert({
      auth_user_id: ownerId,
      business_name: 'Demo Wellness Studio',
      email: OWNER_EMAIL,
      password_hash: passwordHash,
      plan_tier: 'starter',
    })
    if (error) throw error
    console.log('Created demo owner:', ownerId)
  }

  // ── 2. Demo business ───────────────────────────────────────────────────────────
  const placeholderToken = encrypt('placeholder-refresh-token')

  const { data: bizRow, error: bizErr } = await supabase
    .from('businesses')
    .upsert(
      {
        owner_user_id: ownerId,
        name: 'Demo Wellness Studio',
        public_slug: 'demo-wellness',
        whatsapp_number: '+1234567890',
        timezone: 'Europe/London',
        calendar_provider: 'google',
        google_refresh_token_encrypted: placeholderToken,
        dedicated_calendar_id: 'demo_calendar_id',
        calendar_status: 'disconnected',
        business_type: 'wellness',
        batch_size: 3,
        batch_interval_minutes: 30,
        min_notice_hours: 24,
        min_confirm_lead_hours: 12,
      },
      { onConflict: 'owner_user_id' }
    )
    .select('id')
    .single()
  if (bizErr) throw bizErr
  const businessId = bizRow.id
  console.log('Demo business upserted:', businessId)

  // ── 3. Demo client (client_profiles — custom auth, no Supabase Auth user) ──────
  const { data: existingProfile } = await supabase
    .from('client_profiles')
    .select('user_id')
    .eq('email', CLIENT_EMAIL)
    .maybeSingle()

  let clientProfileId: string
  if (existingProfile) {
    clientProfileId = existingProfile.user_id
    console.log('Demo client profile already exists:', clientProfileId)
  } else {
    clientProfileId = randomUUID()
    const { error } = await supabase.from('client_profiles').insert({
      user_id: clientProfileId,
      email: CLIENT_EMAIL,
      name: 'Demo Client',
      phone: '+441234567890',
      password_hash: passwordHash,
    })
    if (error) throw error
    console.log('Created demo client profile:', clientProfileId)
  }

  // ── 4. Link client to demo business ───────────────────────────────────────────
  const { data: existingClient } = await supabase
    .from('clients')
    .select('id')
    .eq('user_id', clientProfileId)
    .eq('business_id', businessId)
    .maybeSingle()

  let clientId: string
  if (existingClient) {
    clientId = existingClient.id
    console.log('Demo client row already exists:', clientId)
  } else {
    const { data: newClient, error } = await supabase
      .from('clients')
      .insert({ user_id: clientProfileId, business_id: businessId })
      .select('id')
      .single()
    if (error) throw error
    clientId = newClient.id
    console.log('Created demo client row:', clientId)
  }

  // ── 5. Active waitlist entry (Mon/Wed/Fri mornings) ───────────────────────────
  const { data: existingEntry1 } = await supabase
    .from('waitlist_entries')
    .select('id')
    .eq('client_id', clientId)
    .eq('business_id', businessId)
    .eq('status', 'active')
    .maybeSingle()

  let entry1Id: string
  if (existingEntry1) {
    entry1Id = existingEntry1.id
    console.log('Demo waitlist entry 1 already exists:', entry1Id)
  } else {
    const { data: e1, error } = await supabase
      .from('waitlist_entries')
      .insert({
        business_id: businessId,
        client_id: clientId,
        time_windows: [
          { day: 'Monday', start: '09:00', end: '12:00' },
          { day: 'Wednesday', start: '10:00', end: '13:00' },
          { day: 'Friday', start: '09:00', end: '12:00' },
        ],
        status: 'active',
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select('id')
      .single()
    if (error) throw error
    entry1Id = e1.id
    console.log('Created demo waitlist entry 1:', entry1Id)
  }

  // ── 6. Second active entry (Tue/Thu afternoons) ───────────────────────────────
  const { data: existingEntry2 } = await supabase
    .from('waitlist_entries')
    .select('id')
    .eq('client_id', clientId)
    .eq('business_id', businessId)
    .eq('status', 'active')
    .neq('id', entry1Id)
    .maybeSingle()

  if (!existingEntry2) {
    const { error } = await supabase.from('waitlist_entries').insert({
      business_id: businessId,
      client_id: clientId,
      time_windows: [
        { day: 'Tuesday', start: '14:00', end: '17:00' },
        { day: 'Thursday', start: '14:00', end: '18:00' },
      ],
      status: 'active',
      expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
    })
    if (error) throw error
    console.log('Created demo waitlist entry 2')
  } else {
    console.log('Demo waitlist entry 2 already exists')
  }

  // ── 7. Pending slot offer notification ────────────────────────────────────────
  const { data: existingNotif } = await supabase
    .from('notifications')
    .select('id')
    .eq('waitlist_entry_id', entry1Id)
    .eq('type', 'slot_offer')
    .eq('status', 'sent')
    .maybeSingle()

  if (!existingNotif) {
    const { error } = await supabase.from('notifications').insert({
      waitlist_entry_id: entry1Id,
      appointment_id: null,
      type: 'slot_offer',
      channel: 'email',
      status: 'sent',
      token: 'demo-offer-token-' + randomUUID(),
      batch_number: 1,
    })
    if (error) throw error
    console.log('Created demo slot offer notification')
  } else {
    console.log('Demo notification already exists')
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Demo credentials
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Owner  (dashboard):  ${OWNER_EMAIL} / ${DEMO_PASSWORD}
Client (waitlists):  ${CLIENT_EMAIL} / ${DEMO_PASSWORD}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
}

seed().catch(err => {
  console.error(err)
  process.exit(1)
})
