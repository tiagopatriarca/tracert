# 🌐 TRACERT+
### Plataforma Integrada de Gestão de Redes, Failover Inteligente e SD-WAN para MikroTik

[![RouterOS v6 & v7](https://img.shields.io/badge/RouterOS-v6%20%7C%20v7-005596.svg)](https://mikrotik.com)
[![Docker Support](https://img.shields.io/badge/Docker-Ready-2496ED.svg)](https://www.docker.com/)
[![Node.js Version](https://img.shields.io/badge/Node.js-20%2B%20%7C%2022%2B-339933.svg)](https://nodejs.org/)
[![Evolution API v2](https://img.shields.io/badge/WhatsApp-Evolution%20API%20v2-25D366.svg)](https://evolution-api.com/)
[![License](https://img.shields.io/badge/License-Proprietary-red.svg)]()

O **TRACERT+** é uma solução centralizada, moderna e escalável projetada para monitoramento em tempo real, telemetria avançada, alta disponibilidade (Failover Multi-Link) e roteamento dinâmico de aplicações (SD-WAN) para parques de roteadores **MikroTik RouterOS (v6 e v7)**.

Diferente de sistemas legados que exigem abertura de portas (NAT), VPNs lentas ou conexões SSH diretas com cada equipamento, o TRACERT+ opera com **agentes autônomos e seguros via RouterOS Scripting**. Toda a comunicação é originada do próprio MikroTik para o servidor via chamadas HTTPS seguras (Outbound Telemetry e OTA Sync).

---

## 📌 Índice
1. [O que o Sistema Faz](#-o-que-o-sistema-faz)
2. [Funcionalidades Principais](#-funcionalidades-principais)
3. [Arquitetura & Como Funciona](#-arquitetura--como-funciona)
4. [Requisitos Mínimos de Instalação](#-requisitos-mínimos-de-instalação)
5. [Instalação & Configuração do Servidor](#-instalação--configuração-do-servidor)
6. [Configuração nos Roteadores MikroTik](#-configuração-nos-roteadores-mikrotik)
7. [Padrões de Nomenclatura no RouterOS](#-padrões-de-nomenclatura-no-routeros)
8. [Estrutura do Repositório](#-estrutura-do-repositório)
9. [Segurança & Boas Práticas](#-segurança--boas-práticas)

---

## 💡 O que o Sistema Faz

O TRACERT+ resolve os três maiores desafios de administradores de redes MikroTik e Provedores/Integradores de TI:
1. **Visibilidade em Tempo Real:** Saiba exatamente quais links de internet estão UP, DOWN ou oscilando, além do consumo de CPU, RAM e status de hardware de dezenas de roteadores em um painel unificado.
2. **Failover Impecável (Zero Falso Retorno):** Garante a troca de link quando a operadora cai ou sofre degradação, eliminando o problema crônico de falsos retornos de status (*false-UP loops*).
3. **Gestão e Atualização em Massa (OTA):** Permite disparar configurações, scripts e atualizações para todo o parque de roteadores com 1 clique, sem precisar logar em Winbox por Winbox.

---

## ✨ Funcionalidades Principais

### 1. 🔄 Failover Multi-Link Universal (v8 Oficial)
- **Descoberta Dinâmica de Operadoras:** Identifica qualquer operadora automaticamente através de comentários em `/ip route` (ex: `LINK - TIM`, `LINK - CLARO`, `LINK - STARLINK`).
- **Agnóstico de Meio Físico:** Suporta nativamente conexões **PPPoE** (discadores), **DHCP Client** e **IP Estático / Fixo**.
- **Isolamento Total de Testes:** No RouterOS v6 utiliza tabelas dedicadas (`rota-de-teste-...`). No RouterOS v7 resolve a interface física via `immediate-gw`, garantindo que testes de operadoras inativas não vazem pela rota default principal.
- **Proteção Anti-False-UP:** Algoritmo com estado de rota que só aciona alertas quando há mudança efetiva de status, impedindo repetições ou falsos retornos imediatos.

### 2. ⚡ SD-WAN Dinâmico de Aplicações
- **Monitoramento Contínuo de Destinos:** Testa latência média (RTT), perda de pacotes e jitter para destinos críticos em `/ip firewall address-list` (`SDWAN_TARGETS`).
- **Comutação Inteligente de Rota:** Redireciona o tráfego da aplicação em tempo real para a operadora com menor latência e zero perda.
- **Histórico e Gráficos:** Registra o link ativo e o RTT histórico de cada destino.

### 3. 📡 Monitoramento de Link Único & Heartbeat
- Script otimizado para roteadores com apenas 1 link WAN (sem SD-WAN/Failover).
- Inclui trava de segurança automática que se auto-aborta caso o roteador receba um segundo link WAN, prevenindo conflitos com o Failover.

### 4. 📊 Telemetria Completa de Hardware
- Coleta periódica (a cada 1 hora ou sob demanda):
  - **CPU:** Percentual de uso, modelo do processador e quantidade de núcleos.
  - **Memória RAM:** Memória total, memória livre e percentual utilizado.
  - **Sistema:** Uptime, versão do RouterOS, firmware da RouterBOARD, modelo e número de série.

### 5. 🚨 Alertas Instantâneos via WhatsApp (Evolution API v2)
- Notificações ricas com emojis formatados:
  - 🚨 **Queda de Link:** Informa o nome do roteador, a operadora e o score de perda.
  - ✅ **Retorno de Link:** Informa a normalização e o tempo total de indisponibilidade.
  - ⚠️ **MikroTik Offline:** Alerta emitido quando o roteador fica sem telemetria por mais de 5 minutos, com **supressão inteligente de repetição** (notifica apenas uma vez para não virar spam).
  - 🔀 **Comutação SD-WAN:** Notifica quando uma aplicação migra de operadora devido à degradação de RTT.
- Suporte a grupos de notificação por cliente/empresa.
- Suporte opcional a Telegram Bot e integração com Google Sheets.

### 6. 🚀 Central de Comandos em Massa & OTA (Over-The-Air)
- Envio remoto de comandos RouterOS em lote para roteadores com fila de execução persistente.
- Filtros inteligentes de envio:
  - Todas as RBs do sistema.
  - Somente RBs com SD-WAN.
  - Somente RBs com Link Único.
  - Somente RouterOS v6 ou RouterOS v7.
  - Seleção manual por checkbox.
- Acompanhamento visual da taxa de sucesso (`PENDING`, `EXECUTED`, `CANCELLED`).

### 7. 🛡️ Segurança & Multi-Tenancy (RBAC)
- Multi-empresa: Roteadores agrupados por clientes com tokens criptográficos únicos (`MK-XXXXX`).
- Perfis de acesso: **Administrador**, **Operador** e **Visualizador**.
- Timeout de inatividade configurável por usuário.
- Headers HTTP de proteção (OWASP / Cloudflare Audit), sanitização de inputs e hash bcrypt de senhas.

---

## 🏗️ Arquitetura & Como Funciona

```text
  +-----------------------------------------------------------------------+
  |                             TRACERT+                                  |
  |         Servidor Central (Node.js + Express + SQLite + Traefik)       |
  |                     https://tracert.suaempresa.com.br                 |
  +-----------------------------------+-----------------------------------+
                                      ^
                                      | HTTPS (Porta 443 Outbound)
                   +------------------+------------------+
                   |                                     |
       +-----------+-----------+             +-----------+-----------+
       |   MikroTik Matriz     |             |   MikroTik Filial     |
       |     RouterOS v7       |             |     RouterOS v6       |
       |  (Failover Multi-WAN) |             |    (Link Único WAN)   |
       +-----------------------+             +-----------------------+
       | • LINK - OPERADORA 1  |             | • LINK - OPERADORA 1  |
       | • LINK - OPERADORA 2  |             +-----------------------+
       | • failover (30s)      |             | • tracert_link_mon    |
       | • tracert_sync (1m)   |             | • tracert_sync (1m)   |
       +-----------------------+             +-----------------------+
```

1. **A RB envia telemetria** via `/tool fetch` em HTTPS para a API com o seu token exclusivo.
2. **O Servidor armazena** o histórico de eventos, processa mudanças de status e aciona a Evolution API (WhatsApp).
3. **A cada 1 minuto**, a RB busca comandos pendentes em `/api/routers/sync/:token` (OTA) e os executa de forma transparente.

---

## 💻 Requisitos Mínimos de Instalação

### Servidor:
| Componente | Requisito Mínimo | Recomendado |
| :--- | :--- | :--- |
| **Sistema Operacional** | Linux (Ubuntu 22.04 LTS / 24.04 LTS, Debian 12) | Ubuntu 24.04 LTS |
| **Processador (CPU)** | 1 vCPU | 2 vCPUs |
| **Memória (RAM)** | 1 GB | 2 GB ou superior |
| **Armazenamento** | 10 GB SSD | 25 GB SSD |
| **Softwares** | Docker 24+ & Docker Compose v2 | Docker Engine atualizado |
| **Rede** | IP Público Fixo com DNS apontado | Proxy Reverso HTTPS (Traefik / Nginx / Cloudflare) |

> [!IMPORTANT]
> O RouterOS exige certificados SSL válidos para comunicação HTTPS sem erros. Certifique-se de configurar um domínio com certificado Let's Encrypt ou Cloudflare no seu proxy reverso.

### Roteadores MikroTik:
- **RouterOS Suportado:** Versões 6.45+ (v6) ou Versões 7.1+ (v7).
- **Modelos:** hAP lite, hEX, RB3011, RB4011, RB5009, CCRs, CHR (Cloud Hosted Router) em nuvem ou qualquer equipamento compatível com RouterOS.
- **Saída de Rede:** Acesso liberado para saída TCP na porta 443 (HTTPS) para o domínio do TRACERT+.

---

## 🚀 Instalação & Configuração do Servidor

### 1. Clonar o Repositório
```bash
git clone https://github.com/tiagopatriarca/tracert.git /docker/tracert
cd /docker/tracert
```

### 2. Configurar o `docker-compose.yml`
Edite o arquivo `docker-compose.yml` ajustando o seu domínio e as credenciais:
```yaml
services:
  tracert:
    build: .
    image: tracert-plus:latest
    container_name: tracert-plus
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - TZ=America/Sao_Paulo
      - PORT=3000
      - NODE_ENV=production
      - DATA_DIR=/app/data
      - JWT_SECRET=COLOQUE_AQUI_UMA_CHAVE_SECRETA_FORTE_ALEATORIA
    volumes:
      - ./data:/app/data
```

*(Se utilizar Traefik ou Nginx com SSL, configure os devidos labels ou proxy reverso para a porta 3000).*

### 3. Iniciar a Aplicação
```bash
docker compose up -d --build
```

O servidor criará automaticamente a estrutura do banco de dados SQLite persistente na pasta `./data/database.sqlite`.

### 4. Primeiro Acesso
- Acesse no navegador: `https://tracert.suaempresa.com.br`
- **Usuário Padrão:** `admin`
- **Senha Padrão:** `123456`
> [!WARNING]
> Altere imediatamente a senha do usuário `admin` no painel em **Administração -> Usuários** após o primeiro login!

### 5. Configurar o WhatsApp (Evolution API)
No menu lateral, acesse **Configurações WhatsApp**:
1. Preencha a **URL Base** (ex: `https://evo.suaempresa.com.br`).
2. Informe o **Nome da Instância** conectada (ex: `Atendimento`).
3. Informe a **API Key Global** da sua Evolution API.
4. Ative as notificações e salve.

---

## 🛠️ Configuração nos Roteadores MikroTik

### Passo 1: Cadastrar o Roteador no Painel
1. No menu lateral, acesse **Roteadores** e clique em **Novo Roteador**.
2. Preencha o Nome (ex: `Matriz-CCR`), selecione o Cliente e defina o modelo.
3. O painel gerará um **Token exclusivo** para o roteador (ex: `MK-TC7FI-4027`).

### Passo 2: Roteadores com Múltiplos Links (Failover & SD-WAN)
1. Certifique-se de que cada rota default em `/ip route` possui o comentário identificador da operadora (veja a seção [Padrões de Nomenclatura](#-padrões-de-nomenclatura-no-routeros)).
2. No painel do TRACERT+, abra os detalhes do roteador e clique em **Gerar Script de Ativação** (ou utilize o arquivo oficial [failover_setup_and_monitor.rsc](mikrotik/failover_setup_and_monitor.rsc)).
3. Cole o script no **Terminal do Winbox**.
4. O script provisionará:
   - Rotas de teste isoladas para cada link.
   - Script de monitoramento contínuo `failover`.
   - Agente de sincronização remota `tracert_sync` (OTA a cada 1 minuto).
   - Agente de telemetria de hardware `tracert_system_telemetry` (a cada 1 hora).

### Passo 3: Roteadores com Link Único
1. Se a RB possui apenas uma conexão de internet e você deseja apenas telemetria de hardware, status de online/offline e comandos remotos OTA:
2. Utilize o script [single_link_monitor.rsc](mikrotik/single_link_monitor.rsc).
3. Substitua `MK-TOKEN-AQUI` pelo token da RB e cole no Winbox.

---

## 🏷️ Padrões de Nomenclatura no RouterOS

Para que o TRACERT+ identifique seus links de forma 100% autônoma, adote a seguinte convenção em `/ip route`:

| Tipo de Link | Configuração no MikroTik (`/ip route`) | Comentário Obrigatório |
| :--- | :--- | :--- |
| **Link 1 (Primário)** | `dst-address=0.0.0.0/0 gateway=192.168.1.1` *(ou discador)* | `LINK - TIM` |
| **Link 2 (Secundário)** | `dst-address=0.0.0.0/0 gateway=GSM` *(ou IP)* | `LINK - GSM` |
| **Link 3 (Backup/Starlink)**| `dst-address=0.0.0.0/0 gateway=192.168.100.1` | `LINK - STARLINK` |

> [!TIP]
> Qualquer texto após `LINK - ` será adotado como o nome amigável da operadora nos cards do painel e nas mensagens do WhatsApp.

### Destinos SD-WAN:
Para monitorar a latência de aplicações específicas no SD-WAN, adicione os IPs ou domínios em `/ip firewall address-list` na lista chamada `SDWAN_TARGETS`:
```routeros
/ip firewall address-list add list="SDWAN_TARGETS" address="8.8.8.8" comment="DNS Google"
/ip firewall address-list add list="SDWAN_TARGETS" address="1.1.1.1" comment="Cloudflare"
/ip firewall address-list add list="SDWAN_TARGETS" address="200.160.2.3" comment="ERP Nuvem"
```

---

## 📁 Estrutura do Repositório

```text
tracert/
├── docker-compose.yml        # Orquestração do container Docker
├── Dockerfile                # Imagem oficial Node 22 Alpine
├── package.json              # Dependências (Express, bcryptjs, JWT, CORS)
├── server.js                 # API Central, WebSocket/Polling, Gerador de Scripts
├── db.js                     # Camada de banco de dados SQLite persistente
├── whatsapp.js               # Conector Evolution API v2 com template de mensagens
├── public/                   # Frontend SPA Web (Glassmorphism UI responsiva)
│   ├── index.html
│   ├── app.js
│   └── styles.css
└── mikrotik/                 # Scripts oficiais para MikroTik RouterOS
    ├── failover_setup_and_monitor.rsc   # Script Universal v8 (Multi-WAN)
    └── single_link_monitor.rsc          # Script para Roteadores de Link Único
```

---

## 🔒 Segurança & Boas Práticas

- **Sem Portas Abertas:** Nunca abra a porta da API do MikroTik (8728) ou Winbox (8291) para a internet. O TRACERT+ não precisa de nenhuma porta de entrada aberta no roteador.
- **TLS/HTTPS:** Toda a troca de dados entre a RB e o servidor TRACERT+ ocorre de forma criptografada via HTTPS (Porta 443).
- **Tokens Individuais:** Se um roteador for desativado ou substituído, basta revogar o token no painel para cortar imediatamente o acesso à API.
- **Sanitização de Comandos OTA:** O sistema valida sintaxe e caracteres perigosos antes de permitir o envio de comandos em lote.

---

## 👨‍💻 Desenvolvido Por
**TI Plus Soluções em Tecnologia**  
Suporte e Integrações: [tiplus.inf.br](https://tiplus.inf.br)
