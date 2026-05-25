const fs = require('fs');
const lines = fs.readFileSync('src/components/Dashboard.tsx', 'utf8').split('\n');

const newHeader = [
    "'use client';",
    "",
    "import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';",
    "import { Flight } from '@/types/flight';",
    "import Logo from './Logo';",
    "import Sparkline from './Sparkline';",
    "import dynamic from 'next/dynamic';",
    "import { ko } from 'date-fns/locale';",
    "import 'react-datepicker/dist/react-datepicker.css';",
    "import * as gtag from '@/lib/analytics';",
    "",
    "// eslint-disable-next-line @typescript-eslint/no-explicit-any",
    "const DatePicker: any = dynamic(() => import('react-datepicker').then((mod: any) => mod.default), { ssr: false });",
    "import styles from './Dashboard.module.css';",
    "import AdCard from './AdCard';",
    "",
    "// 유틸리티 함수 (별도 파일로 분리)",
    "import {",
    "    toDate, toStr, fmtDate, getDefaultStartDate, getDefaultEndDate,",
    "    normalizeCity, normalizeAirline,",
    "    CITY_TO_AIRPORT, getAirportCode,",
    "    getNaverFlightUrl, getSkyscannerUrl,",
    "} from '@/lib/utils/flight-helpers';",
    "import {",
    "    TRIPCOM_ALLIANCE_ID, TRIPCOM_SID, TRIPCOM_SUB3,",
    "    AIRPORT_TO_TRIPCOM_CITY, TRIPCOM_CITY_DATA,",
    "    TRIPCOM_HOTEL_SUB3, IATA_TO_ENGLISH,",
    "    getTripcomHotelUrl,",
    "} from '@/lib/utils/tripcom-helpers';",
    "import { checkIsMobile, getMobileUrl } from '@/lib/utils/mobile-url';",
    "",
    "const ITEMS_PER_PAGE = 20;",
    "",
].join('\n');

// Line 620 (1-indexed) = index 619 = 'export default function Dashboard()'
const remaining = lines.slice(619).join('\n');
const result = newHeader + remaining;
fs.writeFileSync('src/components/Dashboard.tsx', result);
console.log('Original lines:', lines.length);
console.log('New lines:', result.split('\n').length);
console.log('Removed:', lines.length - result.split('\n').length, 'lines');
