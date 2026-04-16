import { Router } from 'express'
import { supabase } from '../config/supabase.js'

const router = Router()

router.post('/sync', async (req, res, next) => {
  try {
    const { diagnosis_event_id } = req.body
    if (!diagnosis_event_id) {
      return res.status(400).json({ success: false, message: 'diagnosis_event_id required.' })
    }
    const { data: ev, error } = await supabase
      .from('diagnosis_events')
      .select('id, confirmed_root_cause_id')
      .eq('id', diagnosis_event_id)
      .single()
    if (error) throw error
    if (!ev?.confirmed_root_cause_id) {
      return res.status(400).json({ success: false, message: 'Confirm diagnosis before syncing to SAP.' })
    }
    const mockNotifId = `1000${Math.floor(Math.random() * 90000 + 10000)}`
    const mockWoId    = `4000${Math.floor(Math.random() * 90000 + 10000)}`
    await supabase
      .from('diagnosis_events')
      .update({ sap_notification_number: mockNotifId, sap_order_number: mockWoId, pending_sync: false })
      .eq('id', diagnosis_event_id)
    res.json({ success: true, message: 'Synced to SAP PM (demo mode).', data: { diagnosis_event_id, sap_notification_number: mockNotifId, sap_order_number: mockWoId } })
  } catch (err) { next(err) }
})

router.get('/pending', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('diagnosis_events')
      .select('id, asset_instance_id, diagnosed_at, pending_sync, confidence_score')
      .eq('pending_sync', true)
      .not('confirmed_root_cause_id', 'is', null)
      .order('diagnosed_at', { ascending: true })
    if (error) throw error
    res.json({ success: true, count: data.length, data })
  } catch (err) { next(err) }
})

export default router
