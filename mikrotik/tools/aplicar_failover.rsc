# =======================================================================
# SCRIPT DE CORREÇÃO DEFINITIVA DO FAILOVER NO MIKROTIK
# =======================================================================

/system script set failover source="# IPs a serem testados
:local IPsParaTeste [:toarray \"8.8.8.8,8.8.4.4,200.160.0.8,31.13.80.8\"]
:local NumeroDePings 2
:local Intervalo 00:00:00.5
:local ScoreMinimoUP 3

:global foRouterName [/system identity get name]
:global foLinkName
:global foLinkStatus
:global foPingScore

:local totalRotasAtivas [/ip route print count-only where dst-address=0.0.0.0/0 routing-table=main disabled=no]

# Testa LINK - TIM
:do {
    :local scoreTIM 0
    :foreach ip in=$IPsParaTeste do={
        :local r [ping $ip count=$NumeroDePings interval=$Intervalo interface=ether1-TIM]
        :set scoreTIM ($scoreTIM + $r)
    }
    :local isDisTIM [/ip route get [find comment=\"LINK - TIM\" and dst-address=0.0.0.0/0] disabled]
    :if ($scoreTIM < $ScoreMinimoUP and $isDisTIM = false) do={
        /ip route set [find comment=\"LINK - TIM\" and dst-address=0.0.0.0/0] disabled=yes
        :set foLinkName \"LINK - TIM\"
        :set foLinkStatus \"DOWN\"
        :set foPingScore $scoreTIM
        /system script run FAILOVER_ACTIONS
    }
    :if ($scoreTIM >= $ScoreMinimoUP and $isDisTIM = true) do={
        /ip route set [find comment=\"LINK - TIM\" and dst-address=0.0.0.0/0] disabled=no
        :set foLinkName \"LINK - TIM\"
        :set foLinkStatus \"UP\"
        :set foPingScore $scoreTIM
        /system script run FAILOVER_ACTIONS
    }
    # Envia status inicial UP
    :if ($isDisTIM = false) do={
        :set foLinkName \"LINK - TIM\"
        :set foLinkStatus \"UP\"
        :set foPingScore $scoreTIM
        /system script run FAILOVER_ACTIONS
    }
} on-error={}

# Testa Link - GSM
:do {
    :local scoreGSM 0
    :foreach ip in=$IPsParaTeste do={
        :local r [ping $ip count=$NumeroDePings interval=$Intervalo interface=GSM]
        :set scoreGSM ($scoreGSM + $r)
    }
    :local isDisGSM [/ip route get [find comment=\"Link - GSM\" and dst-address=0.0.0.0/0] disabled]
    :if ($scoreGSM < $ScoreMinimoUP and $isDisGSM = false) do={
        /ip route set [find comment=\"Link - GSM\" and dst-address=0.0.0.0/0] disabled=yes
        :set foLinkName \"Link - GSM\"
        :set foLinkStatus \"DOWN\"
        :set foPingScore $scoreGSM
        /system script run FAILOVER_ACTIONS
    }
    :if ($scoreGSM >= $ScoreMinimoUP and $isDisGSM = true) do={
        /ip route set [find comment=\"Link - GSM\" and dst-address=0.0.0.0/0] disabled=no
        :set foLinkName \"Link - GSM\"
        :set foLinkStatus \"UP\"
        :set foPingScore $scoreGSM
        /system script run FAILOVER_ACTIONS
    }
    # Envia status inicial UP
    :if ($isDisGSM = false) do={
        :set foLinkName \"Link - GSM\"
        :set foLinkStatus \"UP\"
        :set foPingScore $scoreGSM
        /system script run FAILOVER_ACTIONS
    }
} on-error={}
"
