# =======================================================================
# SCRIPT: TRACERT+ AGENTE DE SINCRONIZACAO E OTA (MODELO 2)
# Consulta a cada 1 minuto se existem comandos pendentes na nuvem
# =======================================================================

/system script remove [find name="tracert_sync"]

/system script add dont-require-permissions=no name="tracert_sync" owner=admin policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon source={
    :local syncUrl "https://tracert.tiplus.inf.br/api/routers/sync?token=MK-TC7FI-4027"
    :do {
        /tool fetch url=$syncUrl dst-path="tracert_sync.rsc" keep-result=yes
        :local f [/file find name="tracert_sync.rsc"]
        :if ([:len $f] > 0) do={
            :local sz [/file get $f size]
            :if ($sz > 45) do={
                /import file-name="tracert_sync.rsc"
                /log info message="[TRACERT+] Comandos sincronizados da nuvem executados com sucesso!"
            }
            /file remove [find name="tracert_sync.rsc"]
        }
    } on-error={}
}

/system scheduler remove [find name="executa_tracert_sync"]
/system scheduler add interval=1m name="executa_tracert_sync" on-event="tracert_sync" policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon start-time=startup
