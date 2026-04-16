import { supabase } from '../config/supabase.js'

export async function diagnose(assetId, symptomIds) {
  if (!symptomIds || symptomIds.length === 0) {
    throw new Error('At least one symptom is required.')
  }

  const { data: candidates, error } = await supabase
    .from('v_fta_inference')
    .select('*')
    .in('symptom_id', symptomIds)
    .order('priority_score', { ascending: false })

  if (error) throw error

  const filtered = candidates.filter(c => c.root_cause_id !== null)

  const seen = new Set()
  const unique = filtered.filter(c => {
    if (seen.has(c.root_cause_id)) return false
    seen.add(c.root_cause_id)
    return true
  })

  const top = unique[0]
  const confidence = top
    ? Math.min(0.99, parseFloat(top.priority_score) / 100 + symptomIds.length * 0.05)
    : 0

  return {
    asset_id: assetId,
    matched_symptom_count: symptomIds.length,
    confidence_score: parseFloat(confidence.toFixed(4)),
    candidates: unique
  }
}

export async function buildFaultTree(assetTypeId) {
  const { data, error } = await supabase
    .from('systems')
    .select(`
      id, name, description,
      components (
        id, name, part_number, criticality_class, mtbf_hours,
        failure_modes (
          id, description, function_affected,
          symptoms (id, description, sensor_tag, auto_detectable, alarm_code),
          root_causes (
            id, description, probability_weight, historical_occurrences,
            rpn_scores (severity, occurrence, detection, total_rpn),
            corrective_actions (
              id, title, estimated_time_hours, skill_required,
              corrective_action_steps (step_order, description),
              spare_parts (material, description, qty, storage_location)
            ),
            mitigative_actions (type, title, description)
          )
        )
      )
    `)
    .eq('asset_type_id', assetTypeId)

  if (error) throw error
  return data
}

export async function buildOfflineAssetCard(assetId) {
  const { data: asset, error: assetErr } = await supabase
    .from('asset_instances')
    .select('*, asset_types(*, modules(name))')
    .eq('id', assetId)
    .single()

  if (assetErr) throw assetErr

  const { data: symptoms, error: symErr } = await supabase
    .from('v_fta_inference')
    .select('*')
    .eq('asset_type_name', asset.asset_types?.name)
    .order('priority_score', { ascending: false })

  if (symErr) throw symErr

  return {
    schema_version: '1.0.0',
    module: asset.asset_types?.modules?.name?.toLowerCase(),
    offline_meta: {
      generated_at: new Date().toISOString(),
      asset_id: assetId,
      pending_sync: false
    },
    asset: {
      id: asset.id,
      type: asset.asset_types?.name,
      manufacturer: asset.asset_types?.manufacturer,
      model: asset.asset_types?.model_family,
      sap_equipment_number: asset.sap_equipment_number,
      functional_location: asset.functional_location,
      plant: asset.plant,
      line: asset.line
    },
    inference_data: symptoms
  }
}

export async function buildSapPayload(diagnosisEventId) {
  const { data: ev, error } = await supabase
    .from('diagnosis_events')
    .select('*, asset_instances(*, asset_types(name))')
    .eq('id', diagnosisEventId)
    .single()

  if (error) throw error
  if (!ev.confirmed_root_cause_id) {
    throw new Error('Diagnosis not yet confirmed.')
  }

  const { data: rc } = await supabase
    .from('v_fta_inference')
    .select('*')
    .eq('root_cause_id', ev.confirmed_root_cause_id)
    .limit(1)
    .single()

  const { data: ca } = await supabase
    .from('corrective_actions')
    .select('*, corrective_action_steps(step_order, description), spare_parts(*)')
    .eq('root_cause_id', ev.confirmed_root_cause_id)
    .maybeSingle()

  const asset    = ev.asset_instances
  const toSapDate = (d) => `/Date(${new Date(d).getTime()})/`

  const notification = {
    MaintNotifType: 'M2',
    TechnicalObject: asset.id,
    TechObjIsEquipOrFuncnlLoc: 'EQUI',
    FunctionalLocation: asset.functional_location,
    NotificationText: `FTAI: ${rc?.root_cause} — ${asset.asset_types?.name}`,
    MalfunctionStartDate: toSapDate(ev.diagnosed_at),
    MaintNotifLongText: [
      `FTAI Diagnosis ID: ${ev.id}`,
      `Root Cause: ${rc?.root_cause}`,
      `RPN: ${rc?.total_rpn} (S=${rc?.severity}/O=${rc?.occurrence}/D=${rc?.detection})`,
      `Priority Score: ${rc?.priority_score}`,
      `Confidence: ${((ev.confidence_score || 0) * 100).toFixed(1)}%`,
      `SOP: ${ca?.id ?? 'N/A'}`,
      `Diagnosed by: ${ev.diagnosed_by}`
    ].join(' | '),
    MaintenancePlannerGroup: 'PM1'
  }

  const workOrder = ca ? {
    MaintenanceOrderType: 'PM01',
    Equipment: asset.id,
    FunctionalLocation: asset.functional_location,
    Plant: asset.plant ?? '1000',
    Priority: (rc?.total_rpn || 0) >= 100 ? '1' : '2',
    PlannedWork: `${ca.estimated_time_hours}H`,
    WorkCenter: 'MANUT-ELET',
    to_MaintenanceOrderOperation: (ca.corrective_action_steps || [])
      .sort((a, b) => a.step_order - b.step_order)
      .map(s => ({
        OperationActivity: String(s.step_order * 10).padStart(4, '0'),
        OperationShortText: s.description.substring(0, 40),
        WorkCenter: 'MANUT-ELET',
        ControlKey: 'PM01'
      })),
    to_MaintenanceOrderComponent: (ca.spare_parts || []).map((p, i) => ({
      ReservationItem: String(i + 1).padStart(4, '0'),
      Material: p.material,
      MaterialDescription: p.description,
      RequiredQuantity: String(p.qty),
      BaseUnit: 'PC',
      StorageLocation: p.storage_location
    }))
  } : null

  return { notification, work_order: workOrder }
}
