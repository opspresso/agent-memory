# EKS 배포

Helm chart는 기본적으로 Agent Memory application만 배포하고 기존 PostgreSQL·S3 호환 storage를 사용한다. 선택형 PostgreSQL(pgvector)·MinIO는 독립 설치에서만 명시적으로 활성화한다. 기본 ingress는 AWS Load Balancer Controller의 `alb` class와 `memory.opspresso.com`을 사용한다.

운영 secret을 파일에 평문으로 저장하지 않으려면 External Secrets 등으로 Kubernetes Secret을 먼저 만들고 `secrets.existingSecret`을 지정하라. Secret에는 최소 `BETTER_AUTH_SECRET`이 필요하며 외부 PostgreSQL·S3를 쓰면 `DATABASE_URL`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`도 포함하라.

공유 infrastructure를 쓰는 기본 렌더링은 다음처럼 확인한다.

```bash
helm template agent-memory deploy/helm/agent-memory \
  --namespace agent-memory \
  --set-string secrets.BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  --set-string secrets.DATABASE_URL=postgresql://user:password@postgres.example:5432/agent_memory \
  --set-string config.extra.S3_ENDPOINT=http://minio.example:9000 \
  --set-string secrets.S3_ACCESS_KEY_ID=replace-me \
  --set-string secrets.S3_SECRET_ACCESS_KEY=replace-me
```

설치는 값 파일을 secret manager에서 안전하게 만들고 다음처럼 수행하라.

```bash
helm upgrade --install agent-memory deploy/helm/agent-memory \
  --namespace agent-memory --create-namespace \
  --values values-agent-memory.yaml
kubectl -n agent-memory rollout status deployment/agent-memory
curl -fsS https://memory.opspresso.com/api/health
```

AWS Load Balancer Controller가 ACM 인증서를 사용하면 `ingress.annotations`에 `alb.ingress.kubernetes.io/certificate-arn`과 `alb.ingress.kubernetes.io/listen-ports`를 설정하라. nginx ingress와 cert-manager를 사용하면 `ingress.className`, annotation, `ingress.tls`를 해당 cluster 정책에 맞춰 바꾸라.

기본 `replicaCount`는 1이며 migration과 document worker가 같은 process에서 실행된다. Application을 여러 replica로 확장하기 전에는 migration을 별도 job에서 한 번 실행하고 web/worker topology를 분리하라.
