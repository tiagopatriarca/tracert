# =======================================================================
# SCRIPT: MONITORAMENTO DE LINK UNICO & HEARTBEAT (TRACERT+ OFICIAL)
# Indicado para: Roteadores com 1 Link WAN (Sem Failover / Sem SD-WAN)
# Padrão: Comentário em /ip route iniciando com "LINK - OPERADORA"
# Compatibilidade: RouterOS v6 (hAP lite, etc.) e RouterOS v7
# URL do Servidor: https://tracert.tiplus.inf.br
# =======================================================================

# Substitua pelo Token da sua RB gerado no Painel TRACERT+
:local routerToken "MK-TOKEN-AQUI"

# 1. Configura o Monitor de Link Unico (Captura rota LINK - OPERADORA)
/system script remove [find name="tracert_link_monitor"]
/system script add dont-require-permissions=no name="tracert_link_monitor" owner=admin policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon source="# Se houver mais de 1 link WAN, aborta para evitar conflito com o failover\r\
\n:local wanCount 0\r\
\n:local linkName \"\"\r\
\n:foreach r in=[/ip route find dst-address=0.0.0.0/0] do={\r\
\n    :local cmt [/ip route get \$r comment]\r\
\n    :if ([:len \$cmt] > 0 and (\$cmt ~ \"[Ll][Ii][Nn][Kk]\") and !(\$cmt ~ \"!==\")) do={\r\
\n        :set wanCount (\$wanCount + 1)\r\
\n        :local hashPos [:find \$cmt \"#\"]\r\
\n        :if ([:typeof \$hashPos] = \"num\") do={ :set cmt [:pick \$cmt 0 \$hashPos] }\r\
\n        :set linkName \$cmt\r\
\n    }\r\
\n}\r\
\n:if (\$wanCount > 1) do={\r\
\n    /log warning message=\"[TRACERT+] tracert_link_monitor desativado: Roteador possui multiplos links WAN (Failover).\"\r\
\n    :error \"Multiplos links WAN\"\r\
\n}\r\
\n:if (\$linkName = \"\") do={ :set linkName \"LINK - PRINCIPAL\" }\r\
\n\r\
\n# Teste de conectividade simples via ping\r\
\n:local pings [/ping 8.8.8.8 count=2 interval=00:00:00.5]\r\
\n:local score 8\r\
\n:local st \"UP\"\r\
\n:if (\$pings = 0) do={\r\
\n    :set score 0\r\
\n    :set st \"DOWN\"\r\
\n}\r\
\n\r\
\n# Envia heartbeat e status do link para o TRACERT+\r\
\n:local payload (\"token=MK-TOKEN-AQUI&link=\" . \$linkName . \"&status=\" . \$st . \"&score=\" . [:tostr \$score])\r\
\n:do {\r\
\n    /tool fetch check-certificate=no http-method=post http-header-field=\"Content-Type: application/x-www-form-urlencoded\" url=\"https://tracert.tiplus.inf.br/api/telemetry/failover/MK-TOKEN-AQUI\" http-data=\$payload keep-result=no\r\
\n} on-error={}\r\
\n"

# 2. Agendador do monitor de link (a cada 1 minuto)
/system scheduler remove [find name="executa_tracert_link_monitor"]
/system scheduler add interval=1m name="executa_tracert_link_monitor" on-event="tracert_link_monitor" policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon start-time=startup

# 3. Configura o Agente de Sincronizacao Remota e OTA (Modelo 2)
/system script remove [find name="tracert_sync"]
/system script add dont-require-permissions=no name="tracert_sync" owner=admin policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon source=":local syncUrl \"https://tracert.tiplus.inf.br/api/routers/sync/MK-TOKEN-AQUI\"\r\
\n:do {\r\
\n    /tool fetch check-certificate=no url=\$syncUrl dst-path=\"tracert_sync.rsc\" keep-result=yes\r\
\n    :local f [/file find name=\"tracert_sync.rsc\"]\r\
\n    :if ([:len \$f] > 0) do={\r\
\n        :local sz [/file get \$f size]\r\
\n        :if (\$sz > 45) do={\r\
\n            /import file-name=\"tracert_sync.rsc\"\r\
\n            /log info message=\"[TRACERT+] Comandos OTA sincronizados e executados com sucesso!\"\r\
\n        }\r\
\n        /file remove [find name=\"tracert_sync.rsc\"]\r\
\n    }\r\
\n} on-error={}\r\
\n"

# 4. Agendador de sincronizacao OTA (a cada 1 minuto)
/system scheduler remove [find name="executa_tracert_sync"]
/system scheduler add interval=1m name="executa_tracert_sync" on-event="tracert_sync" policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon start-time=startup

# 5. Configura Agente de Telemetria de Hardware
/system script remove [find name="tracert_system_telemetry"]
/system script add dont-require-permissions=no name="tracert_system_telemetry" owner=admin policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon source=":local resModel [/system resource get board-name]\r\
\n:local resVersion [/system resource get version]\r\
\n:local resCpu [/system resource get cpu]\r\
\n:local resCpuCount [:tostr [/system resource get cpu-count]]\r\
\n:local resCpuLoad [:tostr [/system resource get cpu-load]]\r\
\n:local resTotalMem [:tostr ([/system resource get total-memory] / 1048576)]\r\
\n:local resFreeMem [:tostr ([/system resource get free-memory] / 1048576)]\r\
\n:local resUptime [:tostr [/system resource get uptime]]\r\
\n:local rbFirmware \"N/A\"\r\
\n:local rbSerial \"N/A\"\r\
\n:do {\r\
\n    :set rbFirmware [/system routerboard get current-firmware]\r\
\n    :set rbSerial [/system routerboard get serial-number]\r\
\n} on-error={}\r\
\n:local payload (\"token=MK-TOKEN-AQUI&model=\" . \$resModel . \"&routerosVersion=\" . \$resVersion . \"&firmwareVersion=\" . \$rbFirmware . \"&cpuModel=\" . \$resCpu . \"&cpuCount=\" . \$resCpuCount . \"&cpuLoad=\" . \$resCpuLoad . \"&totalMemory=\" . \$resTotalMem . \"&freeMemory=\" . \$resFreeMem . \"&uptime=\" . \$resUptime . \"&serialNumber=\" . \$rbSerial)\r\
\n:do {\r\
\n    /tool fetch check-certificate=no http-method=post http-header-field=\"Content-Type: application/x-www-form-urlencoded\" url=\"https://tracert.tiplus.inf.br/api/telemetry/system/MK-TOKEN-AQUI\" http-data=\$payload keep-result=no\r\
\n} on-error={}\r\
\n"

# 6. Agendador de telemetria de hardware (a cada 1 hora)
/system scheduler remove [find name="executa_tracert_telemetria_sistema"]
/system scheduler add interval=1h name="executa_tracert_telemetria_sistema" on-event="tracert_system_telemetry" policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon start-time=startup

# 7. Dispara a primeira execucao imediatamente
:do { /system script run tracert_link_monitor } on-error={}
:do { /system script run tracert_system_telemetry } on-error={}
:do { /system script run tracert_sync } on-error={}

:log info message="[TRACERT+] Monitoramento de Link Unico e Telemetria ativados com sucesso!";
