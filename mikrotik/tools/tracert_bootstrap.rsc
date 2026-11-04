# =======================================================================
# SCRIPT DE ATIVACAO TRACERT+ (UNIVERSAL - ROUTEROS v6 & v7)
# Instruções: Substitua SEU_TOKEN_AQUI pelo Token gerado no painel e cole no terminal
# =======================================================================

:local routerToken "SEU_TOKEN_AQUI"
:local apiBase "https://tracert.tiplus.inf.br"

# 0. Garante que o MikroTik consiga resolver nomes de domínio caso o DNS esteja zerado
:do {
    :local currentDns [/ip dns get servers]
    :if ([:len $currentDns] = 0) do={
        /ip dns set servers=1.1.1.1,8.8.8.8
    }
} on-error={}

# 1. Configura Agente de Telemetria de Hardware & Sistema (v6 e v7)
/system script remove [find name="tracert_system_telemetry"]
/system script add dont-require-permissions=no name="tracert_system_telemetry" owner=admin policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon source={
    :local apiBaseUrl "https://tracert.tiplus.inf.br/api/telemetry/system"
    :local routerToken "SEU_TOKEN_AQUI"

    :local resModel [/system resource get board-name]
    :local resVersion [/system resource get version]
    :local resCpu [/system resource get cpu]
    :local resCpuCount [:tostr [/system resource get cpu-count]]
    :local resCpuLoad [:tostr [/system resource get cpu-load]]
    :local resTotalMem [:tostr ([/system resource get total-memory] / 1048576)]
    :local resFreeMem [:tostr ([/system resource get free-memory] / 1048576)]
    :local resUptime [:tostr [/system resource get uptime]]

    :local rbFirmware "N/A"
    :local rbSerial "N/A"
    :do {
        :set rbFirmware [/system routerboard get current-firmware]
        :set rbSerial [/system routerboard get serial-number]
    } on-error={}

    :local payload ("token=" . $routerToken . \
      "&model=" . $resModel . \
      "&routerosVersion=" . $resVersion . \
      "&firmwareVersion=" . $rbFirmware . \
      "&cpuModel=" . $resCpu . \
      "&cpuCount=" . $resCpuCount . \
      "&cpuLoad=" . $resCpuLoad . \
      "&totalMemory=" . $resTotalMem . \
      "&freeMemory=" . $resFreeMem . \
      "&uptime=" . $resUptime . \
      "&serialNumber=" . $rbSerial)

    :do {
        /tool fetch check-certificate=no http-method=post http-header-field="Content-Type: application/x-www-form-urlencoded" url=($apiBaseUrl . "/" . $routerToken) http-data=$payload keep-result=no
        /log info message=("[TRACERT+] Telemetria de hardware enviada com sucesso!")
    } on-error={
        /log error message=("[TRACERT+] Falha ao enviar telemetria de hardware")
    }
}
/system scheduler remove [find name="executa_tracert_telemetria_sistema"]
/system scheduler add interval=1h name="executa_tracert_telemetria_sistema" on-event="tracert_system_telemetry" policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon start-time=startup

# 2. Configura Agente de Sincronizacao Remota e OTA (Modelo 2)
/system script remove [find name="tracert_sync"]
/system script add dont-require-permissions=no name="tracert_sync" owner=admin policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon source={
    :local syncUrl "https://tracert.tiplus.inf.br/api/routers/sync/SEU_TOKEN_AQUI"
    :do {
        /tool fetch check-certificate=no url=$syncUrl dst-path="tracert_sync.rsc" keep-result=yes
        :local f [/file find name="tracert_sync.rsc"]
        :if ([:len $f] > 0) do={
            :local sz [/file get $f size]
            :if ($sz > 45) do={
                /import file-name="tracert_sync.rsc"
                /log info message="[TRACERT+] Comandos OTA sincronizados e executados com sucesso!"
            }
            /file remove [find name="tracert_sync.rsc"]
        }
    } on-error={}
}
/system scheduler remove [find name="executa_tracert_sync"]
/system scheduler add interval=1m name="executa_tracert_sync" on-event="tracert_sync" policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon start-time=startup

# 3. Dispara a primeira telemetria e sincronização imediatamente
/system script run tracert_system_telemetry
/system script run tracert_sync

:log info message="[TRACERT+] Roteador conectado e provisionado no TRACERT+ com sucesso!"
