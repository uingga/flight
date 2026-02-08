async function main() {
    const response = await fetch('https://b2c-api.modetour.com/CheapTicket/GetList?Page=1&ItemCount=500&DepartureCity=&ContinentCode=AMCA&ArrivalCity=&DepartureDate=2026-02-08&ArrivalDate=2026-03-10', {
        headers: {
            'Accept': 'application/json, text/plain, */*',
            'Origin': 'https://www.modetour.com',
            'Referer': 'https://www.modetour.com/flights/discount-flight',
        }
    });
    const data = await response.json();
    console.log('총 AMCA 항목 수:', data.result.length);
    const vancouver = data.result.filter((item: any) => item.arrival.value.includes('밴쿠버'));
    console.log('밴쿠버 항목 수:', vancouver.length);
    vancouver.forEach((item: any, i: number) => {
        console.log(`${i + 1}. ID: ${item.id}, 가격: ${item.adult.value}, 출발일: ${item.sDate.value}, 항공사: ${item.air.value}`);
    });
}

main();
