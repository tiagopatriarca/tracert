# =======================================================================
# SCRIPT: FAILOVER_ACTIONS (TRACERT+ OFICIAL)
# URL de Produção: https://tracert.tiplus.inf.br
# =======================================================================

/system script remove [find name="FAILOVER_ACTIONS"]

/system script add dont-require-permissions=no name="FAILOVER_ACTIONS" owner=admin policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon source={
    # =============== VARIAVEIS GERAIS =====================================
    :global comentario
    :local comentarioActions $comentario
    :local hashPos [:find $comentario "#"]
    :if ([:typeof $hashPos] = "num") do={
        :set comentarioActions [:pick $comentario 0 $hashPos]
    }

    :global LinkStatus
    :global LinkState
    :local LinkStateActions $LinkState
    :global emoji
    :global routerName [/system identity get name]
    :global foPingScore
    :if ([:len $foPingScore] = 0) do={ :global foPingScore 8 }

    :if ($LinkStateActions > 0) do={
        :global emoji "%F0%9F%9F%A2"
        :global LinkStatus "UP"
    } else={
        :global emoji "%F0%9F%94%B4"
        :global LinkStatus "DOWN"
    }

    # =============== GERAR LOG LOCAL =====================================
    /log warning message=("[FAILOVER] LINK: " . $comentarioActions . " -- STATUS: " . $LinkStatus . " (Score: " . [:tostr $foPingScore] . "/8)")

    # =============== ENVIO TRACERT+ (DISPARA ALERTA EVOLUTION API) ========
    :local apiBaseUrl "https://tracert.tiplus.inf.br/api/telemetry/failover"
    :local routerToken "MK-ARO-MATRIZ-01"   ;# Insira o Token gerado no Painel TRACERT+
    :local payload ("token=" . $routerToken . "&link=" . $comentarioActions . "&status=" . $LinkStatus . "&score=" . [:tostr $foPingScore])

    :do {
        /tool fetch check-certificate=no http-method=post http-header-field="Content-Type: application/x-www-form-urlencoded" url=($apiBaseUrl . "/" . $routerToken) http-data=$payload keep-result=no
    } on-error={
        :do {
            /tool fetch http-method=post http-header-field="Content-Type: application/x-www-form-urlencoded" url=($apiBaseUrl . "/" . $routerToken) http-data=$payload keep-result=no
        } on-error={
            /log error message=("[FAILOVER] Falha ao enviar telemetria para a API do TRACERT+")
        }
    }

    # =============== ENVIO TELEGRAM (OPCIONAL) ===========================
    :global botToken "----"
    :global groupID "--------"
    :if ($botToken != "----" and [:len $botToken] > 0 and $groupID != "--------" and [:len $groupID] > 0) do={
        :delay 2
        :do {
            /tool fetch check-certificate=no url=("https://api.telegram.org/bot" . $botToken . "/sendMessage?chat_id=" . $groupID . "&parse_mode=HTML&text=" . $emoji . $emoji . $emoji . $emoji . "%0A%0A<b>ROTEADOR:</b> " . $routerName . "%0A%0A<b>LINK:</b> " . $comentarioActions . "%0A%0A<b>STATUS:</b> " . $LinkStatus . "%0A____________________________") keep-result=no
        } on-error={}
    }

    # =============== ENVIO GOOGLE SHEETS (OPCIONAL) ======================
    :global urlGoogleSheets "==========="
    :global sheetName "REGISTROS"
    :if ($urlGoogleSheets != "===========" and [:len $urlGoogleSheets] > 0) do={
        :do {
            /tool fetch http-method=post http-header-field="Content-Type: application/json" url=$urlGoogleSheets http-data=("{\"sheet\":\"" . $sheetName . "\",\"ROTEADOR\":\"" . $routerName . "\",\"LINK\":\"" . $comentarioActions . "\",\"STATUS\":\"" . $LinkStatus . "\"}") keep-result=no
        } on-error={}
    }
}
