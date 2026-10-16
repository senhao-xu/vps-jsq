# 构建阶段：编译 Vite 生产包
# 静态产物与 CPU 架构无关，使用原生 Node 编译，避免 ARM64 下的 QEMU 崩溃
FROM --platform=$BUILDPLATFORM node:20-alpine AS build
# 构建时注入 git sha（CI 通过 --build-arg 传入），用于底栏版本号展示
ARG GIT_SHA=dev
ENV VITE_GIT_SHA=${GIT_SHA}
WORKDIR /app

# 先拷贝依赖清单，利用 Docker 层缓存
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# 运行阶段：Nginx 托管静态产物
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
