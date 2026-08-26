# 로컬 컨테이너 배포

Application, PostgreSQL, MinIO를 한 번에 실행하는 production image 기반 로컬 배포다. 코드 변경을 즉시 확인하려면 루트 `compose.yaml`의 PostgreSQL·MinIO와 host의 `pnpm dev`를 사용하라.

```bash
docker compose -f deploy/local/compose.yaml up -d --build
curl -fsS http://localhost:3100/api/health
```

Application은 `http://localhost:3100`, PostgreSQL은 `localhost:5433`, MinIO API와 console은 각각 `localhost:9010`, `localhost:9011`에서 열린다. 기본 credential은 로컬 전용이다.

데이터를 유지한 채 중지하려면 다음을 실행하라.

```bash
docker compose -f deploy/local/compose.yaml down
```

`down -v`는 PostgreSQL과 MinIO 데이터를 삭제하므로 대상과 백업을 확인하기 전에는 실행하지 마라.
