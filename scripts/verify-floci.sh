#!/usr/bin/env bash
# Verifica que Floci soporte los servicios que AegisVolt necesita. Uso: bash scripts/verify-floci.sh
export AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=us-east-1 AWS_PAGER="" MSYS_NO_PATHCONV=1 # Git Bash convierte "/aegisvolt/..." en ruta de Windows sin esto
ok=0; fail=0
check() { local name=$1; shift; if out=$("$@" 2>&1); then echo "OK   $name"; ok=$((ok+1)); else echo "FAIL $name: $(echo "$out" | tail -1)"; fail=$((fail+1)); fi; }
T=verify-$RANDOM

# S3 con versionamiento: dos escrituras deben dejar 2 versiones
check "s3 create bucket"      aws s3api create-bucket --bucket "$T"
check "s3 enable versioning"  aws s3api put-bucket-versioning --bucket "$T" --versioning-configuration Status=Enabled
F=$T.txt; trap 'rm -f "$F"' EXIT # ruta relativa: el aws.exe de Windows no entiende /tmp
echo v1 > "$F"; aws s3 cp "$F" "s3://$T/terraform.tfstate" >/dev/null
echo v2 > "$F"; aws s3 cp "$F" "s3://$T/terraform.tfstate" >/dev/null
check "s3 2 versions"         test "$(aws s3api list-object-versions --bucket "$T" --query 'length(Versions)')" = 2
check "s3 conditional write (If-None-Match, lockfile)" bash -c "! aws s3api put-object --bucket $T --key terraform.tfstate --body $F --if-none-match '*' 2>/dev/null"

# DynamoDB con escritura condicional (idempotencia de la SAGA)
check "ddb create table"      aws dynamodb create-table --table-name "$T" --attribute-definitions AttributeName=pk,AttributeType=S --key-schema AttributeName=pk,KeyType=HASH --billing-mode PAY_PER_REQUEST
check "ddb put"               aws dynamodb put-item --table-name "$T" --item '{"pk":{"S":"saga1#step1"}}' --condition-expression "attribute_not_exists(pk)"
check "ddb duplicate rejected" bash -c "! aws dynamodb put-item --table-name $T --item '{\"pk\":{\"S\":\"saga1#step1\"}}' --condition-expression 'attribute_not_exists(pk)' 2>/dev/null"

# CloudWatch Logs
check "logs group"            aws logs create-log-group --log-group-name "/aegisvolt/$T/billing"
check "logs stream"           aws logs create-log-stream --log-group-name "/aegisvolt/$T/billing" --log-stream-name s1
check "logs put"              aws logs put-log-events --log-group-name "/aegisvolt/$T/billing" --log-stream-name s1 --log-events "[{\"timestamp\":$(date +%s000),\"message\":\"{\\\"correlation_id\\\":\\\"abc\\\"}\"}]"
check "logs filter correlation_id" test -n "$(aws logs filter-log-events --log-group-name "/aegisvolt/$T/billing" --filter-pattern abc --query 'events[0].message' --output text | grep abc)"

# VPC, subred, route table y VPC endpoints
VPC=$(aws ec2 create-vpc --cidr-block 10.42.0.0/16 --query Vpc.VpcId --output text)
check "ec2 vpc"               test -n "$VPC"
SUB=$(aws ec2 create-subnet --vpc-id "$VPC" --cidr-block 10.42.1.0/24 --query Subnet.SubnetId --output text)
RT=$(aws ec2 create-route-table --vpc-id "$VPC" --query RouteTable.RouteTableId --output text)
check "ec2 subnet+rt"         test -n "$SUB" -a -n "$RT"
check "vpce gateway dynamodb" aws ec2 create-vpc-endpoint --vpc-id "$VPC" --service-name com.amazonaws.us-east-1.dynamodb --route-table-ids "$RT"
check "vpce interface logs"   aws ec2 create-vpc-endpoint --vpc-id "$VPC" --vpc-endpoint-type Interface --service-name com.amazonaws.us-east-1.logs --subnet-ids "$SUB"
check "vpce interface execute-api" aws ec2 create-vpc-endpoint --vpc-id "$VPC" --vpc-endpoint-type Interface --service-name com.amazonaws.us-east-1.execute-api --subnet-ids "$SUB"

# API Gateway HTTP v2 + VPC Link hacia un NLB
NLB=$(aws elbv2 create-load-balancer --name "$T" --type network --subnets "$SUB" --query 'LoadBalancers[0].LoadBalancerArn' --output text)
check "elbv2 nlb"             test -n "$NLB"
check "apigw v2 vpc link"     aws apigatewayv2 create-vpc-link --name "$T" --subnet-ids "$SUB"
check "apigw v2 http api"     aws apigatewayv2 create-api --name "$T" --protocol-type HTTP

# EKS (modo real levanta k3s en Docker; puede tardar)
check "eks create cluster"    aws eks create-cluster --name "$T" --role-arn arn:aws:iam::000000000000:role/eks --resources-vpc-config subnetIds="$SUB"

# Persistencia: reinicia Floci y el bucket debe seguir ahí
DOCKER=$(command -v docker.exe || command -v docker) # en Git Bash el wrapper "docker" depende de sh
check "floci restart"         "$DOCKER" restart floci
for _ in $(seq 30); do aws s3api list-buckets >/dev/null 2>&1 && break; done
check "persistence after restart" aws s3api head-bucket --bucket "$T"

echo "---- $ok OK, $fail FAIL"
[ "$fail" -eq 0 ]
