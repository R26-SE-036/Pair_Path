# Code Guru - Java code runner Lambda (container image).
#
#   aws ecr get-login-password | docker login --username AWS --password-stdin <acct>.dkr.ecr.<region>.amazonaws.com
#   docker build -t codeguru-code-runner .
#   docker tag codeguru-code-runner <acct>.dkr.ecr.<region>.amazonaws.com/codeguru-code-runner:latest
#   docker push <acct>.dkr.ecr.<region>.amazonaws.com/codeguru-code-runner:latest
#
# Then create the function FROM THAT IMAGE (package type Image), with:
#   --memory-size 1024      1024 MB is roughly one vCPU; memory is the CPU dial
#   --timeout 35            must exceed COMPILE (20s) + RUN (10s) in index.js,
#                           or Lambda kills the invocation before the handler
#                           can return a readable compile error
#   --vpc-config            a private subnet with NO NAT gateway. This is what
#                           replaces `docker run --network none`; a Lambda
#                           outside a VPC has full internet egress by default,
#                           and student code must not.

FROM public.ecr.aws/lambda/nodejs:20

# Amazon Corretto 17 to match the eclipse-temurin:17 image the Docker-based
# runner used, so a program that compiled before still compiles.
RUN dnf install -y java-17-amazon-corretto-devel && dnf clean all

# Fail the build rather than discover at the first invocation that the image
# has a runtime but no compiler - the JRE and JDK packages are easy to confuse
# and the difference only shows up when a student presses Run.
RUN javac -version && java -version

COPY index.js ${LAMBDA_TASK_ROOT}/

CMD [ "index.handler" ]
