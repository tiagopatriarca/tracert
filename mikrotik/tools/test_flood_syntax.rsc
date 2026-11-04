:local rttTIM 0
/tool flood-ping 8.8.8.8 count=3 size=56 interface=ether1-TIM do={
    :if ($"sent" = 3) do={
        :set rttTIM $"avg-rtt"
    }
}
:put ("rttTIM: " . $rttTIM)