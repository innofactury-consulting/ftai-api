import { Router } from 'express'
import { supabase } from '../config/supabase.js'
import { buildFaultTree, buildOfflineAssetCard } from '../services/ftai-engine.js'

const router = Router()

router.get('/', async (req, res, next) => {
  try {
    const { plant, line } = req.query
    let query = supabase
      .from('asset_instances')
      .select('*, asset_types(*, modules(*))')
      .eq('is_active', true)
      .order('id')
    if (plant) query = query.eq('plant', plant)
    if (line)  query = query.eq('line', line)
    const { data, error } = await query
    if (error) throw error
    res.json({ success: true, count: data.length, data })
  } catch (err) { next(err) }
})

router.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('asset_instances')
      .select('*, asset_types(*, modules(*))')
      .eq('id', req.params.id)
      .single()
    if (error) throw error
    if (!data) return res.status(404).json({ success: false, message: 'Asset not found.' })
    res.json({ success: true, data })
  } catch (err) { next(err) }
})

router.get('/:id/fault-tree', async (req, res, next) => {
  try {
    const { data: asset, error: ae } = await supabase
      .from('asset_instances')
      .select('asset_type_id')
      .eq('id', req.params.id)
      .single()
    if (ae) throw ae
    const tree = await buildFaultTree(asset.asset_type_id)
    res.json({ success: true, asset_id: req.params.id, data: tree })
  } catch (err) { next(err) }
})

router.get('/:id/symptoms', async (req, res, next) => {
  try {
    const { data: asset, error: ae } = await supabase
      .from('asset_instances')
      .select('asset_types(name)')
      .eq('id', req.params.id)
      .single()
    if (ae) throw ae
    const { data, error } = await supabase
      .from('v_fta_inference')
      .select('symptom_id, symptom_description, alarm_code, auto_detectable, system_name, component_name, failure_mode')
      .eq('asset_type_name', asset.asset_types?.name)
      .order('system_name')
    if (error) throw error
    const seen = new Set()
    const unique = data.filter(s => {
      if (seen.has(s.symptom_id)) return false
      seen.add(s.symptom_id)
      return true
    })
    res.json({ success: true, count: unique.length, data: unique })
  } catch (err) { next(err) }
})

router.get('/:id/offline', async (req, res, next) => {
  try {
    const card = await buildOfflineAssetCard(req.params.id)
    res.setHeader('Content-Disposition', `attachment; filename="ftai-offline-${req.params.id}.json"`)
    res.json(card)
  } catch (err) { next(err) }
})

export default router
