import { version as appVersion } from "../../../../package.json";

import { processMetricsSnapshot } from "@/lib/process-metrics";

export function GET(): Response {
  const metrics = processMetricsSnapshot();
  const body = [
    "# HELP agent_memory_build_info Build identity for this instance.",
    "# TYPE agent_memory_build_info gauge",
    `agent_memory_build_info{version="${appVersion}"} 1`,
    "# HELP agent_memory_document_worker_enabled Whether document ingestion is enabled.",
    "# TYPE agent_memory_document_worker_enabled gauge",
    `agent_memory_document_worker_enabled ${process.env.DOCUMENT_WORKER_ENABLED === "true" ? 1 : 0}`,
    "# HELP process_resident_memory_bytes Resident memory size in bytes.",
    "# TYPE process_resident_memory_bytes gauge",
    `process_resident_memory_bytes ${metrics.residentMemoryBytes}`,
    "# HELP process_cpu_seconds_total Total user and system CPU time spent in seconds.",
    "# TYPE process_cpu_seconds_total counter",
    `process_cpu_seconds_total ${metrics.cpuSecondsTotal}`,
    "# HELP nodejs_heap_size_total_bytes Process heap allocation in bytes.",
    "# TYPE nodejs_heap_size_total_bytes gauge",
    `nodejs_heap_size_total_bytes ${metrics.heapTotalBytes}`,
    "# HELP nodejs_heap_size_used_bytes Process heap used in bytes.",
    "# TYPE nodejs_heap_size_used_bytes gauge",
    `nodejs_heap_size_used_bytes ${metrics.heapUsedBytes}`,
    "# HELP nodejs_external_memory_bytes Memory used by C++ objects bound to JavaScript objects.",
    "# TYPE nodejs_external_memory_bytes gauge",
    `nodejs_external_memory_bytes ${metrics.externalMemoryBytes}`,
    "# HELP nodejs_eventloop_delay_p95_seconds Event loop delay p95 since metric collection started.",
    "# TYPE nodejs_eventloop_delay_p95_seconds gauge",
    `nodejs_eventloop_delay_p95_seconds ${metrics.eventLoopDelayP95Seconds}`,
    "# HELP nodejs_eventloop_delay_max_seconds Maximum event loop delay since metric collection started.",
    "# TYPE nodejs_eventloop_delay_max_seconds gauge",
    `nodejs_eventloop_delay_max_seconds ${metrics.eventLoopDelayMaxSeconds}`,
    ""
  ].join("\n");

  return new Response(body, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8"
    }
  });
}
