{{- define "agent-memory.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "agent-memory.fullname" -}}
{{- default .Release.Name .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "agent-memory.labels" -}}
app.kubernetes.io/name: {{ include "agent-memory.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "agent-memory.selectorLabels" -}}
app.kubernetes.io/name: {{ include "agent-memory.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "agent-memory.appSelectorLabels" -}}
{{ include "agent-memory.selectorLabels" . }}
app.kubernetes.io/component: app
{{- end -}}

{{- define "agent-memory.image" -}}
{{- $tag := default (printf "v%s" (trimPrefix "v" .Chart.AppVersion)) .Values.image.tag -}}
{{- printf "%s:%s" .Values.image.repository $tag -}}
{{- end -}}

{{- define "agent-memory.secretName" -}}
{{- default (printf "%s-secrets" (include "agent-memory.fullname" .)) .Values.secrets.existingSecret -}}
{{- end -}}

{{- define "agent-memory.postgresPassword" -}}
{{- required "postgres.password is required when postgres.enabled and must remain stable" .Values.postgres.password -}}
{{- end -}}

{{- define "agent-memory.minioPassword" -}}
{{- required "minio.rootPassword is required when minio.enabled and must remain stable" .Values.minio.rootPassword -}}
{{- end -}}
