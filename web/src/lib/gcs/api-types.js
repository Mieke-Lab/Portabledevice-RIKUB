/**
 * JSDoc typedefs shared between lib modules. No runtime code.
 *
 * @typedef {"uploading"|"unstitched"|"stitching"|"clustering"|"ready"|"failed"|"canceled"} JobStatus
 *
 * @typedef {{
 *   id: string, job_id: string, name: string, status: JobStatus,
 *   area_name: string, area_m2: number|null, captured_at: string,
 *   created_at: string, updated_at: string, image_count: number,
 *   image_glob: string, backend_ref: string, progress: number, error: string,
 *   has_stitched: boolean, has_clusters: boolean, cluster_count: number|null,
 *   artifacts: { raw_dir: string, stitched_tif: string|null, clusters_kml: string|null }
 * }} BackendJob
 *
 * @typedef {{
 *   available: boolean, init_error: string, mission_running: boolean,
 *   last_command: string, last_error: string, fcu_connected?: boolean,
 *   armed?: boolean, mode?: string, position?: {x:number,y:number,z:number}|null
 * }} DroneStatus
 *
 * @typedef {{
 *   available: boolean, job_id?: string,
 *   state: {connected:boolean,armed:boolean,guided:boolean,mode:string,system_status:number}|null,
 *   global_position: {latitude:number,longitude:number,altitude:number}|null,
 *   imu: {orientation:{x:number,y:number,z:number,w:number}}|null,
 *   gps_raw: {fix_type:number,lat:number,lon:number,alt:number,satellites_visible:number,vel:number,cog:number}|null
 * }} DroneDiagnostics
 *
 * @typedef {{ default_addr: string }} DroneConfig
 */
