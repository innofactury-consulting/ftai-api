import { Router } from 'express'
import { supabase } from '../config/supabase.js'
import { diagnose, buildSapPayload } from '../services/ftai-engine.js'

const router = Router()

router.post('/', async (req, res, next) => {
  try {
    const { asset_id, symptom_ids, diagnosed_by } = req.body
    if (!asset_id || !Array.isArray(symptom_ids) || symptom_ids.length === 0) {
      return res.status(400).json({ success: false, message: 'asset_id and at least one symptom_id are required.' })
    }
    const result = await diagnose(asset_id, symptom_ids)
    const { data: event, error: evErr } = await supabase
      .from('diagnosis_events')
      .insert({
        asset_instance_id: asset_id,
        diagnosed_by: diagnosed_by ?? 'FTAI_APP',
        confidence_score: result.confidence_score,
        pending_sync: true
      })
      .select()
      .single()
    if (evErr) throw evErr
    res.status(201).json({
      success: true,
      data: {
        diagnosis_event_id: event.id,
        asset_id,
        confidence_score: result.confidence_score,
        matched_symptom_count: result.matched_symptom_count,
        candidates: result.candidates
      }
    })
  } catch (err) { next(err) }
})

router.get('/', async (req, res, next) => {
  try {
    const { asset_id, limit = 20 } = req.query
    let q = supabase
      .from('diagnosis_events')
      .select('id, asset_instance_id, diagnosed_by, diagnosed_at, pending_sync, confidence_score, sap_order_number')
      .order('diagnosed_at', { ascending: false })
      .limit(parseInt(limit))
    if (asset_id) q = q.eq('asset_instance_id', asset_id)
    const { data, error } = await q
    if (error) throw error
    res.json({ success: true, count: data.length, data })
  } catch (err) { next(err) }
})

router.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('diagnosis_events')
      .select('*')
      .eq('id', req.params.id)
      .single()
    if (error) throw error
    if (!data) return res.status(404).json({ success: false, message: 'Diagnosis not found.' })
    res.json({ success: true, data })
  } catch (err) { next(err) }
})

router.patch('/:id/confirm', async (req, res, next) => {
  try {
    const { confirmed_root_cause_id, symptom_id, discarded_root_cause_ids, notes } = req.body
    if (!confirmed_root_cause_id) {
      return res.status(400).json({ success: false, message: 'confirmed_root_cause_id is required.' })
    }
    const { data: updated, error } = await supabase
      .from('diagnosis_events')
      .update({
        confirmed_root_cause_id,
        symptom_id: symptom_id ?? null,
        discarded_root_cause_ids: discarded_root_cause_ids ?? null,
        pending_sync: true
      })
      .eq('id', req.params.id)
      .select()
      .single()
    if (error) throw error
    const sap = await buildSapPayload(req.params.id)
    res.json({ success: true, message: 'Diagnosis confirmed. RPN updated. SAP payload ready.', data: { ...updated, sap_payload: sap } })
  } catch (err) { next(err) }
})

router.patch('/:id/discard', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('diagnosis_events')
      .update({ pending_sync: false })
      .eq('id', req.params.id)
      .select()
      .single()
    if (error) throw error
    res.json({ success: true, data })
  } catch (err) { next(err) }
})

router.get('/:id/sap-payload', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('diagnosis_events')
      .select('confirmed_root_cause_id')
      .eq('id', req.params.id)
      .single()
    if (error) throw error
    if (!data?.confirmed_root_cause_id) {
      return res.status(404).json({ success: false, message: 'Confirm diagnosis first.' })
    }
    const sap = await buildSapPayload(req.params.id)
    res.json({ success: true, data: sap })
  } catch (err) { next(err) }
})

export default router
