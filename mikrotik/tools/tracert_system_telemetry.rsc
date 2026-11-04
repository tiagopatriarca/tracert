# =======================================================================
# SCRIPT: MIKROTIK HARDWARE & SYSTEM TELEMETRY
# Coleta modelo, CPU, memória, versão do RouterOS, firmware e serial
# e atualiza automaticamente o cadastro no TRACERT+
# =======================================================================

/system script remove [find name="tracert_system_telemetry"]

/system script add dont-require-permissions=no name="tracert_system_telemetry" owner=admin policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon source={
    # --- CONFIGURACAO ---
    :local apiBaseUrl "https://tracert.tiplus.inf.br/api/telemetry/system"
    :local routerToken "SEU_TOKEN_AQUI"   ;# Insira o Token gerado no Painel TRACERT+

    # 1. Coleta dados de /system resource
    :local resModel [/system resource get board-name]
    :local resVersion [/system resource get version]
    :local resCpu [/system resource get cpu]
    :local resCpuCount [/system resource get cpu-count]
    :local resCpuLoad [/system resource get cpu-load]
    :local resTotalMem ([/system resource get total-memory] / 1048576)
    :local resFreeMem ([/system resource get free-memory] / 1048576)
    :local resUptime [/system resource get uptime]

    # 2. Coleta dados de /system routerboard
    :local rbFirmware "N/A"
    :local rbSerial "N/A"
    :do {
        :set rbFirmware [/system routerboard get current-firmware]
        :set rbSerial [/system routerboard get serial-number]
    } on-error={}

    # 3. Monta payload JSON
    :local payload ("{\"token\":\"" . $routerToken . "\"," . \
      "\"model\":\"" . $resModel . "\"," . \
      "\"routerosVersion\":\"" . $resVersion . "\"," . \
      "\"firmwareVersion\":\"" . $rbFirmware . "\"," . \
      "\"cpuModel\":\"" . $resCpu . "\"," . \
      "\"cpuCount\":" . $resCpuCount . "," . \
      "\"cpuLoad\":" . $resCpuLoad . "," . \
      "\"totalMemory\":" . $resTotalMem . "," . \
      "\"freeMemory\":" . $resFreeMem . "," . \
      "\"uptime\":\"" . $resUptime . "\"," . \
      "\"serialNumber\":\"" . $rbSerial . "\"}")

    # 4. Envia via POST para a API
    :do {
        /tool fetch http-method=post http-header-field="Content-Type: application/json" url=($apiBaseUrl . "?token=" . $routerToken) http-data=$payload keep-result=no
        /log info message=("[TRACERT+] Telemetria de hardware e sistema enviada com sucesso!")
    } on-error={
        /log error message=("[TRACERT+] Erro ao enviar telemetria de sistema para o TRACERT+")
    }
}

# Agendador para atualizar dados de hardware/sistema uma vez a cada hora (ou após reboot)
/system scheduler remove [find name="executa_tracert_telemetria_sistema"]
/system scheduler add interval=1h name="executa_tracert_telemetria_sistema" on-event="tracert_system_telemetry" policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon start-time=startup
