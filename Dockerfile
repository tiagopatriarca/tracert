FROM node:22-alpine

WORKDIR /app

# Instala dependências do package.json
COPY package*.json ./
RUN npm install --omit=dev

# Copia o código da aplicação
COPY . .

# Expõe a porta interna da aplicação
EXPOSE 3000

# Volume para persistência do banco de dados SQLite
VOLUME [ "/app/data" ]

# Inicia o servidor
CMD ["node", "server.js"]
