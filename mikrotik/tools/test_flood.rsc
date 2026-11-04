:local rttSum 0
:local rttCount 0
/tool flood-ping 8.8.8.8 count=3 size=56 interface=ether1-TIM do={
    :if ($"sent" > 0 and [:len $"rtt"] > 0) do={
        :set rttSum ($rttSum + $"rtt")
        :set rttCount ($rttCount + 1)
    }
}
:put ("rttCount: " . $rttCount . " avg: " . ($rttSum / $rttCount))