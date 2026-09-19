# Allegra P3 infrastructure

This directory contains the repeatable deployment path for the Ship It track:

`Amplify Hosting → App Runner → DynamoDB / SSM → CloudWatch`

No AWS account mutations are performed from the repository. Run the commands below from an authenticated deployment shell, or use the GitHub Actions workflow after configuring its OIDC role.

## 1. Bootstrap shared resources

Use a strong random value for `JWT_SECRET`; never commit it or put it in a workflow file.

```bash
aws cloudformation deploy \
  --stack-name allegra-core-prod \
  --template-file infra/aws/core.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    EnvironmentName=prod \
    BillingAlertEmail=you@example.com \
    JwtSecret="$JWT_SECRET" \
    SaavnApiUrl="$SAAVN_API_URL" \
    GaanaApiUrl="$GAANA_API_URL"
```

The stack creates on-demand DynamoDB tables, an ECR repository, the App Runner pull and instance roles, SSM parameters, and the optional USD 10 budget notification. The cache table uses `cacheKey` / `expiresAt`, matching the current API adapter.

## 2. Push the API image

The `deploy-api.yml` workflow does this on pushes to `main` when the repository variables `AWS_REGION`, `AWS_ROLE_ARN`, and `ECR_REPOSITORY` are configured. An IAM role ARN is not a secret; the role itself must trust GitHub's OIDC provider and allow ECR push actions for this repository.

For a one-off push, use the URI from the `ApiRepositoryUri` CloudFormation output:

```bash
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_REGISTRY"
docker build --tag "$ECR_REGISTRY/$ECR_REPOSITORY:latest" apps/api
docker push "$ECR_REGISTRY/$ECR_REPOSITORY:latest"
```

## 3. Create App Runner

Pass the outputs from `allegra-core-prod` into `app-runner.yaml`. App Runner's deployment role reads runtime values from SSM; no access keys or provider tokens are placed in the container environment by GitHub.

```bash
aws cloudformation deploy \
  --stack-name allegra-api-prod \
  --template-file infra/aws/app-runner.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    ImageIdentifier="$ECR_REGISTRY/$ECR_REPOSITORY:latest" \
    EcrAccessRoleArn="$ECR_ACCESS_ROLE_ARN" \
    InstanceRoleArn="$INSTANCE_ROLE_ARN" \
    JwtSecretParameterArn="$JWT_PARAMETER_ARN" \
    SaavnApiUrlParameterArn="$SAAVN_PARAMETER_ARN" \
    GaanaApiUrlParameterArn="$GAANA_PARAMETER_ARN" \
    LrclibApiUrlParameterArn="$LRCLIB_PARAMETER_ARN" \
    CacheTableName="$CACHE_TABLE" \
    UsersTableName="$USERS_TABLE" \
    LibrariesTableName="$LIBRARIES_TABLE" \
    AllegraOrigin="https://YOUR_AMPLIFY_DOMAIN"
```

The App Runner health check is `/api/health`. Its output is the API URL needed by the Amplify build.

## 4. Configure Amplify Hosting

Connect the GitHub repository and branch `main`, select the monorepo build specification at `/amplify.yml`, and set the build-time environment variable:

```text
VITE_API_BASE_URL=https://YOUR_APP_RUNNER_DOMAIN
```

Because Vite inlines this value at build time, changing it requires an Amplify redeploy. Add the rule in [`amplify-rewrites.json`](amplify-rewrites.json) in the Amplify console so client-side routes rewrite to `/index.html` with status `200`.

## 5. Verify the deployed seam

```bash
CONTRACT_BASE_URL=https://YOUR_APP_RUNNER_DOMAIN npm run contract-test
CONTRACT_SONG_ID=KNOWN_SONG_ID \
  CONTRACT_BASE_URL=https://YOUR_APP_RUNNER_DOMAIN npm run contract-test
```

The second command additionally asserts `206 Partial Content`, `Content-Range`, and `Accept-Ranges` on the stream proxy. Check the Amplify URL from a phone on mobile data before submission.

## Local integration

The mock is contract-shaped and has a real byte-range stream:

```bash
npm run mock
curl -i -H 'Range: bytes=100-200' http://localhost:9090/api/stream/mock-coldplay
```

The response must be `206` with `Content-Range: bytes 100-200/...`. Set the frontend's `VITE_API_BASE_URL` to `http://localhost:9090` while developing against it.
