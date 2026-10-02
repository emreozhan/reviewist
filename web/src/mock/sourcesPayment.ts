import { code } from './code';

export const paymentGatewayOld = code`
package com.shop.domain.payment;

import com.shop.domain.money.Money;

/**
 * Outbound port to the payment provider.
 */
public interface PaymentGateway {

    /**
     * Charges the customer.
     *
     * @return true if the charge succeeded
     */
    boolean charge(Money amount, String customerId);

    void refund(String transactionId);
}
`;

export const paymentGatewayNew = code`
package com.shop.domain.payment;

import com.shop.domain.money.Money;

/**
 * Outbound port to the payment provider.
 */
public interface PaymentGateway {

    /**
     * Charges the customer.
     *
     * @param idempotencyKey prevents charging the same order twice
     * @return the provider's transaction result
     * @throws PaymentException if the provider rejects the request
     */
    PaymentResult charge(Money amount, String customerId, String idempotencyKey) throws PaymentException;

    void refund(String transactionId);
}
`;

export const paymentResultNew = code`
package com.shop.domain.payment;

public record PaymentResult(String transactionId, boolean approved, String failureReason) {

    public static PaymentResult success(String transactionId) {
        return new PaymentResult(transactionId, true, null);
    }

    public static PaymentResult failure(String reason) {
        return new PaymentResult(null, false, reason);
    }
}
`;

export const paymentExceptionNew = code`
package com.shop.domain.payment;

public class PaymentException extends Exception {

    private final String providerCode;

    public PaymentException(String message, String providerCode) {
        super(message);
        this.providerCode = providerCode;
    }

    public String getProviderCode() {
        return providerCode;
    }
}
`;

export const stripeOld = code`
package com.shop.adapter.out.payment;

import com.shop.domain.money.Money;
import com.shop.domain.payment.PaymentGateway;
import com.stripe.exception.StripeException;
import com.stripe.model.Charge;
import com.stripe.param.ChargeCreateParams;
import org.springframework.stereotype.Component;

@Component
public class StripePaymentGateway implements PaymentGateway {

    private final StripeClientFactory clients;

    public StripePaymentGateway(StripeClientFactory clients) {
        this.clients = clients;
    }

    @Override
    public boolean charge(Money amount, String customerId) {
        try {
            ChargeCreateParams params = ChargeCreateParams.builder()
                    .setAmount(amount.toMinorUnits())
                    .setCurrency(amount.currency().getCurrencyCode())
                    .setCustomer(customerId)
                    .build();
            Charge charge = clients.client().charges().create(params);
            return "succeeded".equals(charge.getStatus());
        } catch (StripeException e) {
            return false;
        }
    }

    @Override
    public void refund(String transactionId) {
        clients.client().refunds().create(transactionId);
    }
}
`;

export const stripeNew = code`
package com.shop.adapter.out.payment;

import com.shop.domain.money.Money;
import com.shop.domain.payment.PaymentException;
import com.shop.domain.payment.PaymentGateway;
import com.shop.domain.payment.PaymentResult;
import com.stripe.exception.CardException;
import com.stripe.exception.StripeException;
import com.stripe.model.Charge;
import com.stripe.net.RequestOptions;
import com.stripe.param.ChargeCreateParams;
import org.springframework.stereotype.Component;

@Component
public class StripePaymentGateway implements PaymentGateway {

    private final StripeClientFactory clients;

    public StripePaymentGateway(StripeClientFactory clients) {
        this.clients = clients;
    }

    @Override
    public PaymentResult charge(Money amount, String customerId, String idempotencyKey) throws PaymentException {
        ChargeCreateParams params = ChargeCreateParams.builder()
                .setAmount(amount.toMinorUnits())
                .setCurrency(amount.currency().getCurrencyCode())
                .setCustomer(customerId)
                .build();
        RequestOptions options = RequestOptions.builder()
                .setIdempotencyKey(idempotencyKey)
                .build();
        try {
            Charge charge = clients.client().charges().create(params, options);
            if ("succeeded".equals(charge.getStatus())) {
                return PaymentResult.success(charge.getId());
            }
            return PaymentResult.failure(charge.getFailureMessage());
        } catch (CardException e) {
            return PaymentResult.failure(e.getDeclineCode());
        } catch (StripeException e) {
            throw new PaymentException("Stripe request failed: " + e.getMessage(), e.getCode());
        }
    }

    @Override
    public void refund(String transactionId) {
        clients.client().refunds().create(transactionId);
    }
}
`;

export const iyzicoOld = code`
package com.shop.adapter.out.payment;

import com.iyzipay.Options;
import com.iyzipay.model.Payment;
import com.iyzipay.model.Status;
import com.iyzipay.request.CreatePaymentRequest;
import com.shop.domain.money.Money;
import com.shop.domain.payment.PaymentGateway;

public class IyzicoPaymentGateway implements PaymentGateway {

    private final Options options;

    public IyzicoPaymentGateway(Options options) {
        this.options = options;
    }

    @Override
    public boolean charge(Money amount, String customerId) {
        CreatePaymentRequest request = new CreatePaymentRequest();
        request.setPrice(amount.value());
        request.setPaidPrice(amount.value());
        request.setCurrency(amount.currency().getCurrencyCode());
        request.setBuyerId(customerId);
        Payment payment = Payment.create(request, options);
        return Status.SUCCESS.getValue().equals(payment.getStatus());
    }

    @Override
    public void refund(String transactionId) {
        throw new UnsupportedOperationException("Iyzico refunds are not supported yet");
    }
}
`;

export const iyzicoNew = code`
package com.shop.adapter.out.payment;

import com.iyzipay.Options;
import com.iyzipay.model.Payment;
import com.iyzipay.model.Status;
import com.iyzipay.request.CreatePaymentRequest;
import com.shop.domain.money.Money;
import com.shop.domain.payment.PaymentException;
import com.shop.domain.payment.PaymentGateway;
import com.shop.domain.payment.PaymentResult;

public class IyzicoPaymentGateway implements PaymentGateway {

    private final Options options;

    public IyzicoPaymentGateway(Options options) {
        this.options = options;
    }

    @Override
    public PaymentResult charge(Money amount, String customerId, String idempotencyKey) throws PaymentException {
        CreatePaymentRequest request = new CreatePaymentRequest();
        request.setConversationId(idempotencyKey);
        request.setPrice(amount.value());
        request.setPaidPrice(amount.value());
        request.setCurrency(amount.currency().getCurrencyCode());
        request.setBuyerId(customerId);
        Payment payment = Payment.create(request, options);
        if (Status.SUCCESS.getValue().equals(payment.getStatus())) {
            return PaymentResult.success(payment.getPaymentId());
        }
        return PaymentResult.failure(payment.getErrorMessage());
    }

    @Override
    public void refund(String transactionId) {
        throw new UnsupportedOperationException("Iyzico refunds are not supported yet");
    }
}
`;

export const placeOrderOld = code`
package com.shop.application;

import com.shop.domain.money.Money;
import com.shop.domain.order.Order;
import com.shop.domain.order.OrderLine;
import com.shop.domain.order.OrderRepository;
import com.shop.domain.payment.PaymentGateway;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PlaceOrderService {

    private final OrderRepository orders;
    private final PaymentGateway payments;

    public PlaceOrderService(OrderRepository orders, PaymentGateway payments) {
        this.orders = orders;
        this.payments = payments;
    }

    @Transactional
    public Order place(Order order) {
        validate(order);
        Money total = order.getTotal();
        boolean paid = payments.charge(total, order.customerId());
        if (!paid) {
            throw new IllegalStateException("Payment failed for order " + order.id());
        }
        order.markPaid();
        return orders.save(order);
    }

    private void validate(Order order) {
        if (order.lines().isEmpty()) {
            throw new IllegalArgumentException("Order has no lines");
        }
        for (OrderLine line : order.lines()) {
            if (line.quantity() <= 0) {
                throw new IllegalArgumentException("Invalid quantity for " + line.sku());
            }
        }
    }
}
`;

export const placeOrderNew = code`
package com.shop.application;

import com.shop.domain.money.Money;
import com.shop.domain.order.Order;
import com.shop.domain.order.OrderRepository;
import com.shop.domain.payment.PaymentException;
import com.shop.domain.payment.PaymentGateway;
import com.shop.domain.payment.PaymentResult;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PlaceOrderService {

    private final OrderRepository orders;
    private final PaymentGateway payments;
    private final OrderValidator validator;

    public PlaceOrderService(OrderRepository orders, PaymentGateway payments, OrderValidator validator) {
        this.orders = orders;
        this.payments = payments;
        this.validator = validator;
    }

    @Transactional
    public Order place(Order order) {
        validator.validate(order);
        Money total = order.totalAmount();
        PaymentResult result;
        try {
            result = payments.charge(total, order.customerId(), order.id().toString());
        } catch (PaymentException e) {
            throw new IllegalStateException("Payment failed for order " + order.id(), e);
        }
        if (!result.approved()) {
            throw new IllegalStateException("Payment declined for order " + order.id() + ": " + result.failureReason());
        }
        order.markPaid();
        return orders.save(order);
    }
}
`;

export const orderValidatorNew = code`
package com.shop.application;

import com.shop.domain.order.Order;
import com.shop.domain.order.OrderLine;
import org.springframework.stereotype.Component;

@Component
public class OrderValidator {

    public void validate(Order order) {
        if (order.lines().isEmpty()) {
            throw new IllegalArgumentException("Order has no lines");
        }
        for (OrderLine line : order.lines()) {
            if (line.quantity() <= 0) {
                throw new IllegalArgumentException("Invalid quantity for " + line.sku());
            }
        }
    }
}
`;

export const placeOrderTestOld = code`
package com.shop.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.shop.domain.order.Order;
import com.shop.domain.order.OrderRepository;
import com.shop.domain.order.OrderStatus;
import com.shop.domain.payment.PaymentGateway;
import org.junit.jupiter.api.Test;

class PlaceOrderServiceTest {

    private final OrderRepository orders = mock(OrderRepository.class);
    private final PaymentGateway payments = mock(PaymentGateway.class);
    private final PlaceOrderService service = new PlaceOrderService(orders, payments);

    @Test
    void placesPaidOrder() {
        Order order = TestOrders.withOneLine();
        when(payments.charge(any(), anyString())).thenReturn(true);
        when(orders.save(order)).thenReturn(order);

        assertThat(service.place(order).status()).isEqualTo(OrderStatus.PAID);
    }

    @Test
    void rejectsFailedPayment() {
        Order order = TestOrders.withOneLine();
        when(payments.charge(any(), anyString())).thenReturn(false);

        assertThatThrownBy(() -> service.place(order)).isInstanceOf(IllegalStateException.class);
    }
}
`;

export const placeOrderTestNew = code`
package com.shop.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.shop.domain.order.Order;
import com.shop.domain.order.OrderRepository;
import com.shop.domain.order.OrderStatus;
import com.shop.domain.payment.PaymentGateway;
import com.shop.domain.payment.PaymentResult;
import org.junit.jupiter.api.Test;

class PlaceOrderServiceTest {

    private final OrderRepository orders = mock(OrderRepository.class);
    private final PaymentGateway payments = mock(PaymentGateway.class);
    private final PlaceOrderService service = new PlaceOrderService(orders, payments, new OrderValidator());

    @Test
    void placesPaidOrder() throws Exception {
        Order order = TestOrders.withOneLine();
        when(payments.charge(any(), anyString(), anyString())).thenReturn(PaymentResult.success("tx-1"));
        when(orders.save(order)).thenReturn(order);

        assertThat(service.place(order).status()).isEqualTo(OrderStatus.PAID);
    }

    @Test
    void rejectsDeclinedPayment() throws Exception {
        Order order = TestOrders.withOneLine();
        when(payments.charge(any(), anyString(), anyString())).thenReturn(PaymentResult.failure("insufficient_funds"));

        assertThatThrownBy(() -> service.place(order)).isInstanceOf(IllegalStateException.class);
    }
}
`;
