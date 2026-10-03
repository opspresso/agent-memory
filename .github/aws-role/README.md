# GitHub Actions의 ECR 게시 권한 설정

GitHub Actions에서 Agent Memory image를 ECR에 게시할 IAM 역할을 준비하는 운영자용 절차다. 역할 생성과 정책 변경에는 해당 AWS 계정의 IAM 관리 권한이 필요하다.

| 파일 | 역할 |
| --- | --- |
| [trust-policy.json](trust-policy.json) | `opspresso/agent-memory`의 `v*` tag workflow가 GitHub OIDC로 역할을 맡을 수 있게 한다. |
| [role-policy.json](role-policy.json) | ECR 로그인과 `agent-memory` repository의 image 게시·조회에 필요한 권한을 지정한다. |
| [release.yml](../workflows/release.yml) | 실제 AWS 계정·region·역할과 게시 image 주소를 사용한다. |

## 1. 실행 대상 확인

AWS CLI를 인증한 뒤 저장소 루트에서 다음 디렉터리로 이동한다.

```bash
cd .github/aws-role
aws sts get-caller-identity --query '{Account:Account,Arn:Arn}'
```

출력된 계정이 두 JSON 정책과 release workflow의 계정과 같은지 확인한다. 다른 계정에 설치하려면 역할을 만들기 전에 세 파일의 ARN을 맞춘다. GitHub OIDC provider도 대상 계정에 있어야 한다.

```bash
export MEMORY_ECR_ROLE=github--agent-memory-ecr
export MEMORY_AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export MEMORY_ECR_POLICY_ARN="arn:aws:iam::${MEMORY_AWS_ACCOUNT}:policy/${MEMORY_ECR_ROLE}"
```

## 2. 새 역할과 정책 생성

역할과 정책이 아직 없을 때만 실행한다. 이미 있으면 [기존 정책 갱신](#기존-정책-갱신)을 따른다.

```bash
aws iam create-role \
  --role-name "$MEMORY_ECR_ROLE" \
  --description 'Agent Memory release image publisher' \
  --assume-role-policy-document file://trust-policy.json

aws iam create-policy \
  --policy-name "$MEMORY_ECR_ROLE" \
  --policy-document file://role-policy.json

aws iam attach-role-policy \
  --role-name "$MEMORY_ECR_ROLE" \
  --policy-arn "$MEMORY_ECR_POLICY_ARN"
```

### 기존 정책 갱신

신뢰 대상을 바꿀 때는 역할의 trust policy를 갱신한다. ECR 권한을 바꿀 때는 새 policy version을 만든다. 필요한 변경만 실행한다.

```bash
aws iam update-assume-role-policy \
  --role-name "$MEMORY_ECR_ROLE" \
  --policy-document file://trust-policy.json

aws iam create-policy-version \
  --policy-arn "$MEMORY_ECR_POLICY_ARN" \
  --policy-document file://role-policy.json \
  --set-as-default
```

`EntityAlreadyExists`이면 생성 대신 기존 리소스를 확인한다. Policy version 한도 오류가 나면 사용하지 않는 이전 version의 정리 여부를 먼저 결정한다. 인증·권한 오류가 나면 현재 AWS 계정과 IAM 권한을 확인한다.

## 3. 연결과 릴리즈 결과 확인

```bash
aws iam get-role --role-name "$MEMORY_ECR_ROLE" \
  --query 'Role.{Arn:Arn,Trust:AssumeRolePolicyDocument}'

aws iam list-attached-role-policies --role-name "$MEMORY_ECR_ROLE"
```

역할의 신뢰 정책과 연결한 policy ARN이 준비한 값과 같아야 한다. Workflow 설정은 별도 예시를 복사하지 말고 [release.yml](../workflows/release.yml)의 `release` job을 확인한다. 이 job은 OIDC로 역할을 맡으므로 고정 AWS access key를 등록하지 않는다.

승인된 릴리즈에서 `Configure AWS credentials (OIDC)`, `Login to ECR`, `Build and push`가 성공하고 해당 tag의 image가 ECR에 있으면 게시 권한 검증을 마친다. 이 문서의 설정 확인만으로 실제 게시 성공을 판단하지 않는다.
