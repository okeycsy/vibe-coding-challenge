package com.kftc.feecalc.domain.fee.service;

import org.springframework.stereotype.Component;

import com.kftc.feecalc.domain.fee.entity.Business;
import com.kftc.feecalc.domain.fee.entity.Institution;

/**
 * 엑셀 업로드가 없을 때 쓰는 시연용 기관 실적.
 * 업무·기간·기관을 시드로 한 결정적 의사난수라서 같은 조건이면 항상 같은 값이 나온다.
 * 프론트엔드 data/mockData.js getBaseCounts 와 같은 값을 만든다.
 */
@Component
public class DemoVolumeGenerator {

    public long baseCount(Business business, Period period, Institution inst) {
        double r = seeded(business.getCode() + "-" + period.from() + "-" + period.to() + "-" + inst.getCode());
        double volume = business.getBaseVolume() * period.scale() * inst.getVolumeWeight() * (0.85 + r * 0.3);
        return Math.max(10, Math.round(volume / 10) * 10);
    }

    /** FNV-1a 32bit 해시 → [0, 1) (JS 의 Math.imul 과 같은 32bit 곱셈) */
    static double seeded(String str) {
        int h = (int) 2166136261L;
        for (int i = 0; i < str.length(); i++) {
            h ^= str.charAt(i);
            h *= 16777619;
        }
        return (Integer.toUnsignedLong(h) % 10000) / 10000.0;
    }
}
