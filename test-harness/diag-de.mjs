import * as XLSX from 'xlsx'
import { buildMetadataWorkbook, parseMetadataFile } from '../src/lib/metadataExporter.js'
const AUTH = 'Basic ' + Buffer.from('admin:district').toString('base64')
const BASE = 'https://play.im.dhis2.org/stable-2-42-4'
const g = async p => (await fetch(BASE+p,{headers:{Authorization:AUTH,Accept:'application/json'}})).json()
const type = {
  key:'dataElements', label:'Data Elements', resource:'dataElements',
  fields:'id,name,shortName,code,description,valueType,domainType,aggregationType,categoryCombo[id,name],zeroIsSignificant',
  columns:[
    {key:'id',label:'ID'},{key:'name',label:'Name *',required:true},
    {key:'shortName',label:'Short Name *',required:true},{key:'code',label:'Code'},
    {key:'description',label:'Description'},{key:'valueType',label:'Value Type *',required:true},
    {key:'domainType',label:'Domain Type *',required:true},{key:'aggregationType',label:'Aggregation Type *',required:true},
    {key:'categoryCombo.id',label:'Category Combo ID'},{key:'categoryCombo.name',label:'Category Combo Name',readOnly:true},
    {key:'zeroIsSignificant',label:'Zero Is Significant'},
  ],
}
const r = await g(`/api/dataElements?fields=${encodeURIComponent(type.fields)}&pageSize=2`)
console.log('=== API response item 0 ===')
console.log(JSON.stringify(r.dataElements[0], null, 2))

const {wb} = buildMetadataWorkbook(type, r.dataElements)
const ws = wb.Sheets['Data Elements']
const rows = XLSX.utils.sheet_to_json(ws, { header: 1 })
console.log('=== Workbook rows ===')
console.log('HEADERS:', JSON.stringify(rows[0]))
console.log('ROW 1:', JSON.stringify(rows[1]))

const buf = XLSX.write(wb, {type:'buffer', bookType:'xlsx'})
const wb2 = XLSX.read(buf,{type:'buffer'})
const {payload} = parseMetadataFile(wb2, type)
console.log('=== First parsed item ===')
console.log(JSON.stringify(payload.dataElements[0], null, 2))
