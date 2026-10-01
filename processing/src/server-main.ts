import path from 'node:path'
import { createProcessingServer } from './server.ts'

const dataDir = path.resolve(process.env.PROCESSING_DATA_DIR ?? '.processing-data')
const port = Number(process.env.PROCESSING_PORT ?? '8798')
const server = createProcessingServer({ dataDir, port, host: '127.0.0.1' })
server.listen(port, '127.0.0.1', () => console.log(`History3D processing API: http://127.0.0.1:${port}/api/processing/v1/capabilities`))
await (server as typeof server & { resumePendingJobs: () => Promise<void> }).resumePendingJobs()
