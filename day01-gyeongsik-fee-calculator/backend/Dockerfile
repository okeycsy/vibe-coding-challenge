# 회비자동산출시스템 백엔드 이미지 (Render 등 Docker 지원 호스팅용)
# 빌드: docker build -t fee-calc-backend .   실행: docker run -p 8080:8080 fee-calc-backend

FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /app
COPY pom.xml .
RUN mvn -q -B dependency:go-offline
COPY src ./src
RUN mvn -q -B package -DskipTests

FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar
# 무료 플랜(메모리 512MB)에 맞춰 힙을 컨테이너 메모리 비율로 제한하고, 공개 서버에서는 H2 콘솔을 끈다
ENV JAVA_OPTS="-XX:MaxRAMPercentage=75 -XX:+UseSerialGC" \
    H2_CONSOLE_ENABLED=false
EXPOSE 8080
ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar app.jar"]
