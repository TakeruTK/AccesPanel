FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache tzdata

COPY package.json ./
RUN npm install

COPY . .

ENV PORT=2000
ENV TZ=America/Santiago
EXPOSE 2000

CMD ["npm", "start"]
